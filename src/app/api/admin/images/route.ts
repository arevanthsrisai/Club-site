import { NextResponse } from "next/server";
import {
    getAdminContext,
    logServerActivity,
    unauthorized,
    forbidden,
} from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
    IMAGE_STASH_NAMESPACE,
    friendlyImageUrl,
    sanitizeImageName,
} from "@/lib/imageStash";
import {
    ImageUploadError,
    canUploadToStash,
    readImageUpload,
} from "@/lib/imageStashServer";
import {
    extFor,
    getStorageConfig,
    uploadObject,
    validateKey,
} from "@/lib/objectStorage";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/images
 *
 * Uploads one image into the Image Stash and registers it in the
 * `image_assets` index. Returns the asset, including its stable friendly URL
 * (`/api/images/{id}`) for use on alumni profiles and other admin content.
 *
 * Security:
 * - Firebase ID token + approved admin required.
 * - Caller must hold a content-management permission (gallery/alumni/etc.).
 * - Bytes are sniffed; only real images pass.
 * - Object keys are server-generated under `image-stash/`; the browser never
 *   chooses a path or a filename.
 * - Identical bytes are de-duplicated against the existing index.
 */
export async function POST(request: Request) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!canUploadToStash(ctx)) {
            return forbidden("gallery.manage | alumni.manage | excore.manage | team.manage | resources.manage | events.manage");
        }

        const config = getStorageConfig();
        if (!config) {
            return NextResponse.json(
                {
                    error:
                        "Object storage is not configured. Set the B2_* environment variables (B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY) and restart the server.",
                },
                { status: 503 },
            );
        }

        const upload = await readImageUpload(request);
        const db = getAdminFirestore();

        // Re-selecting the same image should reuse the asset, not create a twin.
        const existing = await db.collection("image_assets")
            .where("checksum", "==", upload.checksum)
            .limit(1)
            .get();
        if (!existing.empty) {
            const doc = existing.docs[0];
            const data = doc.data() as Record<string, unknown>;
            return NextResponse.json({
                asset: {
                    id: doc.id,
                    url: friendlyImageUrl(doc.id),
                    key: data.key ?? null,
                    filename: data.filename ?? upload.file.name,
                    contentType: data.contentType ?? upload.optimized.contentType,
                    size: data.size ?? upload.optimized.data.length,
                    checksum: data.checksum ?? upload.checksum,
                },
                reused: true,
            });
        }

        const ext = upload.optimized.ext || extFor(upload.optimized.contentType) || ".bin";
        const key = `${IMAGE_STASH_NAMESPACE}/${crypto.randomUUID()}-${sanitizeImageName(upload.file.name)}${ext}`;
        if (!validateKey(key)) {
            return NextResponse.json({ error: "Generated object key failed validation." }, { status: 500 });
        }

        await uploadObject(config, key, upload.optimized.data, upload.optimized.contentType);

        const id = crypto.randomUUID();
        const url = friendlyImageUrl(id);
        const { FieldValue } = await import("firebase-admin/firestore");

        try {
            await db.collection("image_assets").doc(id).set({
                url,
                key,
                filename: upload.file.name.slice(0, 180) || sanitizeImageName(upload.file.name),
                contentType: upload.optimized.contentType,
                size: upload.optimized.data.length,
                originalSize: upload.original.length,
                checksum: upload.checksum,
                source: "upload",
                provider: "b2",
                revision: 1,
                uploadedBy: ctx.uid,
                uploadedByName: ctx.name,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        } catch (err) {
            // Never leave an object the index does not know about.
            try {
                const { deleteObjectPermanent } = await import("@/lib/objectStorage");
                await deleteObjectPermanent(config, key);
            } catch (cleanupErr) {
                console.error("[image-stash] Could not roll back an unindexed upload:", cleanupErr);
            }
            throw err;
        }

        await logServerActivity(ctx.uid, ctx.name, "UPLOAD_IMAGE_ASSET", {
            assetId: id,
            keyPrefix: `${IMAGE_STASH_NAMESPACE}/`,
            contentType: upload.optimized.contentType,
        });

        return NextResponse.json({
            asset: {
                id,
                url,
                key,
                filename: upload.file.name,
                contentType: upload.optimized.contentType,
                size: upload.optimized.data.length,
                checksum: upload.checksum,
            },
            reused: false,
        }, { status: 201 });
    } catch (err) {
        if (err instanceof ImageUploadError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("[image-stash] Upload failed:", err);
        const message = err instanceof Error ? err.message : "Upload failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
