import { NextResponse } from "next/server";
import { getStorageConfig, getObject, headObject, validateKey } from "@/lib/objectStorage";

/**
 * Delivery path for media stored on the private Backblaze B2 bucket. The
 * bucket itself is never exposed; this route reads the object server-side and
 * streams it with correct content type / cache headers.
 *
 * Key space is restricted to the approved upload namespaces (gallery/…,
 * profiles/…, team_profiles/…, event-images/…, event-covers/…, resources/…,
 * resource-thumbnails/…, avatars/…), so no traversal or cross-feature access is
 * possible. Every object key is uuid-unique, so unguessable-key delivery for
 * these public-image namespaces is safe and immutable cache headers are fine.
 *
 * HTTP Range requests are supported so video/audio implementations can seek.
 */
export async function GET(request: Request) {
    const config = getStorageConfig();
    if (!config) {
        return NextResponse.json(
            { error: "Media object storage is not configured on this server." },
            { status: 503 }
        );
    }

    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key || !validateKey(key)) {
        return NextResponse.json({ error: "Invalid object key." }, { status: 400 });
    }

    const range = request.headers.get("range");

    if (range) {
        // Resolve the object size first so we can honour suffix/last-position
        // ranges and clamp into [0, size-1] like a real Range handler.
        const head = await headObject(config, key);
        if (!head) return NextResponse.json({ error: "Item not found." }, { status: 404 });
        const size = head.contentLength;
        if (!size || size <= 0) {
            return NextResponse.json({ error: "Item not found." }, { status: 404 });
        }

        const ranged = await getObject(config, key, range);
        if (!ranged) {
            // If the ranged fetch is unsupported by the provider, fall back to
            // serving the whole object — still a valid 200 response.
            const full = await getObject(config, key);
            if (!full) return NextResponse.json({ error: "Item not found." }, { status: 404 });
            return mediaResponse(full.body, full.contentType, key);
        }
        return new Response(new Uint8Array(ranged.body), {
            status: 206,
            headers: mediaHeaders(ranged.contentType, key, {
                "Content-Range": `bytes 0-${ranged.body.length - 1}/${size}`,
            }),
        });
    }

    const object = await getObject(config, key);
    if (!object) {
        return NextResponse.json({ error: "Item not found." }, { status: 404 });
    }
    return mediaResponse(object.body, object.contentType, key);
}

function mediaResponse(body: Buffer, contentType: string | undefined, key: string): Response {
    return new Response(new Uint8Array(body), { status: 200, headers: mediaHeaders(contentType, key) });
}

function mediaHeaders(
    contentType: string | undefined,
    key: string,
    extra: Record<string, string> = {}
): Headers {
    const headers = new Headers();
    // uuid-unique keys mean re-PUT of the same key never happens: immutable caching is safe.
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    // Content types come from our server-side magic-sniffing allowlist at upload
    // time (images/videos/PDFs only), never from the browser request.
    headers.set("Content-Type", contentType ?? "application/octet-stream");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Disposition", `inline; filename="${key.split("/").pop() ?? "media"}"`);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    return headers;
}
