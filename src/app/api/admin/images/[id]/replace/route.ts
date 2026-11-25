import { NextResponse } from "next/server";
import {
    getAdminContext,
    forbidden,
    logServerActivity,
    unauthorized,
} from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
    IMAGE_STASH_NAMESPACE,
    friendlyImageUrl,
    isAssetId,
    sanitizeImageName,
} from "@/lib/imageStash";
import {
    ImageUploadError,
    canDeleteFromStash,
    readImageUpload,
} from "@/lib/imageStashServer";
import {
    extFor,
    getStorageConfig,
    uploadObject,
    validateKey,
} from "@/lib/objectStorage";

export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/images/{id}/replace
 *
 * Swaps the bytes behind an asset while keeping its stable friendly URL, so
 * every profile already pointing at `/api/images/{id}` picks up the new image
 * without being rewritten.
 *
 * The previous object is deliberately NOT deleted: a manually copied
 * `/api/gallery/media?key=…` link must keep resolving. The response says so.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!canDeleteFromStash(ctx)) return forbidden("gallery.manage");

        const { id } = await context.params;
        if (!isAssetId(id)) {
            return NextResponse.json({ error: "Invalid image asset id." }, { status: 400 });
        }

        const config = getStorageConfig();
        if (!config) {
            return NextResponse.json(
                { error: "Object storage is not configured on this server." },
                { status: 503 },
            );
        }

        const db = getAdminFirestore();
        const ref = db.collection("image_assets").doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
            return NextResponse.json({ error: "Image not found." }, { status: 404 });
        }
        const previous = snap.data() as { key?: string | null; revision?: number };

        const upload = await readImageUpload(request);
        const ext = upload.optimized.ext || extFor(upload.optimized.contentType) || ".bin";
        const key = `${IMAGE_STASH_NAMESPACE}/${crypto.randomUUID()}-${sanitizeImageName(upload.file.name)}${ext}`;
        if (!validateKey(key)) {
            return NextResponse.json({ error: "Generated object key failed validation." }, { status: 500 });
        }

        await uploadObject(config, key, upload.optimized.data, upload.optimized.contentType);

        const { FieldValue } = await import("firebase-admin/firestore");
        await ref.set({
            key,
            url: friendlyImageUrl(id),
            filename: upload.file.name.slice(0, 180) || sanitizeImageName(upload.file.name),
            contentType: upload.optimized.contentType,
            size: upload.optimized.data.length,
            originalSize: upload.original.length,
            checksum: upload.checksum,
            provider: "b2",
            externalUrl: FieldValue.delete(),
            revision: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await logServerActivity(ctx.uid, ctx.name, "REPLACE_IMAGE_ASSET", {
            assetId: id,
            previousRevision: previous.revision ?? 1,
        });

        return NextResponse.json({
            ok: true,
            asset: {
                id,
                url: friendlyImageUrl(id),
                key,
                filename: upload.file.name,
                contentType: upload.optimized.contentType,
                size: upload.optimized.data.length,
                checksum: upload.checksum,
            },
            message:
                "Image replaced. Existing references were preserved. The previous file was kept so manually copied media links keep working.",
        });
    } catch (err) {
        if (err instanceof ImageUploadError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("[image-stash] Replace failed:", err);
        const message = err instanceof Error ? err.message : "Replace failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
