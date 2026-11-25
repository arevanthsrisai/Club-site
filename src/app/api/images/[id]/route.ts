import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { isAssetId } from "@/lib/imageStash";
import { getObject, getStorageConfig, validateKey } from "@/lib/objectStorage";

export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/images/{assetId}
 *
 * Stable, friendly delivery URL for every Image Stash asset. This is the URL
 * admins copy and the URL stored on alumni profiles, so replacing the bytes
 * behind an asset updates every reference automatically.
 *
 * - B2-backed assets are streamed from the private bucket; credentials stay
 *   server-side (same model as /api/gallery/media).
 * - Imported external assets (Firebase Storage, etc.) redirect to their
 *   original location so legacy images keep working untouched.
 *
 * Assets are replaceable, so the response is cached for a short window rather
 * than forever. New uploads get a fresh asset id, so long-lived caching is
 * unnecessary for correctness.
 */
export async function GET(_request: Request, context: RouteContext) {
    const { id } = await context.params;
    if (!isAssetId(id)) {
        return NextResponse.json({ error: "Invalid image id." }, { status: 400 });
    }

    const snap = await getAdminFirestore().collection("image_assets").doc(id).get();
    if (!snap.exists) {
        return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }

    const asset = snap.data() as {
        key?: string | null;
        externalUrl?: string | null;
        contentType?: string;
    };

    if (asset.key) {
        if (!validateKey(asset.key)) {
            return NextResponse.json({ error: "Stored object key failed validation." }, { status: 500 });
        }
        const config = getStorageConfig();
        if (!config) {
            return NextResponse.json({ error: "Media storage is not configured." }, { status: 503 });
        }
        const object = await getObject(config, asset.key);
        if (!object) {
            return NextResponse.json({ error: "Image not found." }, { status: 404 });
        }
        return new Response(new Uint8Array(object.body), {
            status: 200,
            headers: imageHeaders(object.contentType ?? asset.contentType, `${id}`),
        });
    }

    if (asset.externalUrl) {
        let target: URL;
        try {
            target = new URL(asset.externalUrl);
        } catch {
            return NextResponse.json({ error: "Image location is invalid." }, { status: 500 });
        }
        if (target.protocol !== "https:" && target.protocol !== "http:") {
            return NextResponse.json({ error: "Image location is invalid." }, { status: 500 });
        }
        return NextResponse.redirect(target, {
            status: 307,
            headers: { "Cache-Control": "public, max-age=300" },
        });
    }

    return NextResponse.json({ error: "Image not found." }, { status: 404 });
}

function imageHeaders(contentType: string | undefined, id: string): Headers {
    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    headers.set("Content-Type", contentType || "application/octet-stream");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Disposition", `inline; filename="${id}"`);
    return headers;
}
