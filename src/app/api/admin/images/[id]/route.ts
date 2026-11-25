import { NextResponse } from "next/server";
import {
    getAdminContext,
    forbidden,
    logServerActivity,
    unauthorized,
} from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { isAssetId } from "@/lib/imageStash";
import { canDeleteFromStash } from "@/lib/imageStashServer";
import { describeReferences, findImageReferences } from "@/lib/imageReferences";
import { deleteObjectPermanent, getStorageConfig, validateKey } from "@/lib/objectStorage";

export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * DELETE /api/admin/images/{id}
 *
 * Removes an asset from the stash and, when its bytes live in our B2 bucket,
 * deletes those bytes permanently (all versions). Assets referenced by an
 * alumni profile, team profile, event, resource or gallery item are refused
 * with the list of places that use them — never silently broken.
 *
 * Imported assets whose bytes live on another provider only have their index
 * entry removed; the original file is untouched (reported honestly).
 */
export async function DELETE(request: Request, context: RouteContext) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!canDeleteFromStash(ctx)) return forbidden("gallery.manage");

    const { id } = await context.params;
    if (!isAssetId(id)) {
        return NextResponse.json({ error: "Invalid image asset id." }, { status: 400 });
    }

    const db = getAdminFirestore();
    const ref = db.collection("image_assets").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
        return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }
    const asset = snap.data() as {
        key?: string | null;
        provider?: string;
        filename?: string;
    };

    const references = await findImageReferences({ id, key: asset.key ?? null });
    if (references.length > 0) {
        return NextResponse.json(
            {
                error: `This image cannot be deleted — it is still in use. ${describeReferences(references)}`,
                code: "AssetInUse",
                references,
            },
            { status: 409 },
        );
    }

    let storageDeleted = false;
    if (asset.key) {
        if (!validateKey(asset.key)) {
            return NextResponse.json({ error: "Stored object key failed validation." }, { status: 500 });
        }
        const config = getStorageConfig();
        if (!config) {
            return NextResponse.json({ error: "Object storage is not configured." }, { status: 503 });
        }
        await deleteObjectPermanent(config, asset.key);
        storageDeleted = true;
    }

    await ref.delete();

    await logServerActivity(ctx.uid, ctx.name, "DELETE_IMAGE_ASSET", {
        assetId: id,
        storageDeleted,
        provider: asset.provider ?? "b2",
    });

    return NextResponse.json({
        ok: true,
        storageDeleted,
        message: storageDeleted
            ? "Image deleted from storage."
            : "Removed from the stash index. The original file lives on an external provider and was not deleted.",
    });
}
