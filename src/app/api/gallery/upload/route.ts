import { NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/serverAuth";
import { getAdminContext, hasPermission, logServerActivity } from "@/lib/serverAuthz";
import {
    getStorageConfig, sniffMedia, buildGalleryKey, uploadObject, losslesslyOptimize,
    MAX_GALLERY_UPLOAD_BYTES,
} from "@/lib/objectStorage";
import { compressVideo, checkFfmpeg } from "@/lib/videoCompress";
import { generateVideoThumbnail } from "@/lib/videoThumbnail";

/**
 * Server-side gallery upload to Backblaze B2.
 *
 * Auth: Firebase ID token required; the caller must be an approved admin
 * holding "gallery.manage" (CTO always qualifies) — never client-checked.
 * Input: multipart/form-data { file, eventId }.
 *
 * Images are stored losslessly recompressed where possible (PNG/AVIF -> WebP
 * lossless when smaller) or byte-for-byte when the store is already optimal.
 *
 * Videos are normalized with FFmpeg into browser-compatible H.264/AAC MP4
 * (never a bigger-than-original remux) and get a generated poster thumbnail.
 * Processing results — including failures — are reported in the response so
 * the client can mark the item honestly; the original bytes are preserved in
 * B2 (with a `-orig` suffix key) whenever the compressed output is missing or
 * crashed, enabling recovery and future reprocessing without a re-upload.
 */
export async function POST(request: Request) {
    const auth = await verifyAuthToken(request);
    if (!auth) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    // Server-side admin authorization (permission catalog, fail-closed).
    const ctx = await getAdminContext(request);
    if (!ctx || !ctx.isAdmin) return NextResponse.json({ error: "Only approved admins can upload gallery media." }, { status: 403 });
    if (!hasPermission(ctx, "gallery.manage")) return NextResponse.json({ error: "Forbidden: requires the \"gallery.manage\" permission" }, { status: 403 });

    const config = getStorageConfig();
    if (!config) return NextResponse.json({ error: "Gallery object storage is not configured. Set the B2_* environment variables (B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY) and restart the server." }, { status: 503 });

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
    }
    const file = form.get("file");
    const eventId = form.get("eventId");
    if (!(file instanceof File) || typeof eventId !== "string" || !eventId.trim()) {
        return NextResponse.json({ error: "A file and eventId are required." }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_GALLERY_UPLOAD_BYTES) {
        return NextResponse.json({ error: `File must be between 1 byte and ${Math.round(MAX_GALLERY_UPLOAD_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
    }

    // Validate real content, not the browser-provided MIME type.
    const buf = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMedia(buf, file.type);
    if (!sniffed) return NextResponse.json({ error: "Unsupported media type (jpg/png/gif/webp/avif/mp4/webm/pdf)." }, { status: 400 });

    const eventIdClean = eventId.trim();
    const baseName = file.name.replace(/\.[^.]+$/, "");

    // ------------------------------ images / pdf ------------------------------
    if (sniffed.type !== "video") {
        const optimized = await losslesslyOptimize(buf, sniffed.contentType);
        const key = buildGalleryKey(eventIdClean, baseName, optimized.ext);
        if (!key) return NextResponse.json({ error: "Invalid event reference." }, { status: 400 });

        try {
            const url = await uploadObject(config, key, optimized.data, optimized.contentType);
            await logServerActivity(ctx.uid, ctx.name, "Uploaded gallery media", { namespace: "gallery", contentType: optimized.contentType, key });
            return NextResponse.json({
                url, key, contentType: optimized.contentType,
                originalSize: buf.length, storedSize: optimized.data.length,
                lossless: optimized.contentType === "image/webp" && optimized.contentType !== sniffed.contentType,
                processingStatus: "done",
            });
        } catch (error) {
            console.error("Gallery upload failed:", error);
            return NextResponse.json({ error: "Upload to storage failed. Please try again." }, { status: 500 });
        }
    }

    // --------------------------------- video ---------------------------------
    // Processing runs entirely server-side; the browser cannot spoof codecs.
    const result = await compressVideo(buf, sniffed.contentType);
    let stored = result.data;         // H.264/AAC MP4 (playable in every browser)
    let storedContentType = result.contentType;
    let originalKey: string | undefined;
    let processingStatus: "done" | "partial" = "done";
    let processingError: string | undefined;

    if (!stored) {
        // Compression failed: keep the original usable rather than rejecting
        // the upload — the media still plays for webm/mp4 sources; document
        // the honest status so the UI never claims full success.
        processingStatus = "partial";
        processingError = result.error;
        stored = buf;
        storedContentType = sniffed.contentType;
    }

    // Preserve the original verbatim when the stored output differs (recovery
    // and future reprocessing without a re-upload).
    if (!stored.equals(buf)) {
        try {
            const origKey = buildGalleryKey(eventIdClean, `${baseName}-orig`, extForVideo(sniffed.contentType));
            if (origKey) {
                await uploadObject(config, origKey, buf, sniffed.contentType);
                originalKey = origKey;
            }
        } catch (err) {
            console.warn("Original video preservation failed (continuing):", err);
        }
    }

    const videoKey = buildGalleryKey(eventIdClean, baseName, extForVideo(storedContentType));
    if (!videoKey) return NextResponse.json({ error: "Invalid event reference." }, { status: 400 });

    try {
        const url = await uploadObject(config, videoKey, stored, storedContentType);

        // Poster thumbnail from the SOURCE bytes (always works even when the
        // compression quality dropped the source's first frames).
        let thumbnailKey: string | undefined;
        try {
            const thumb = await generateVideoThumbnail(buf, sniffed.contentType);
            if (thumb) {
                const tk = buildGalleryKey(eventIdClean, `${baseName}-thumb`, thumb.ext);
                if (tk) {
                    await uploadObject(config, tk, thumb.data, thumb.contentType);
                    thumbnailKey = tk;
                }
            }
        } catch (err) {
            console.warn("Video thumbnail generation failed (video stored):", err);
        }
        if (!thumbnailKey && processingStatus === "done") {
            processingStatus = "partial";
            processingError = processingError ?? "Thumbnail generation failed.";
        }

        await logServerActivity(ctx.uid, ctx.name, "Uploaded gallery media", { namespace: "gallery", contentType: storedContentType, key: videoKey });

        return NextResponse.json({
            url, key: videoKey, contentType: storedContentType,
            thumbnailKey, originalKey, processingStatus, ...(processingError ? { processingError } : {}),
            originalSize: buf.length, storedSize: stored.length,
        });
    } catch (error) {
        console.error("Gallery video upload failed:", error);
        return NextResponse.json({ error: "Upload to storage failed. Please try again." }, { status: 500 });
    }
}

/** Falls back to ".mp4" so unknown-but-valid video containers still get a key. */
function extForVideo(contentType: string): string {
    switch (contentType) {
        case "video/mp4": return ".mp4";
        case "video/webm": return ".webm";
        default: return ".mp4";
    }
}

// Re-export for tests referencing the availability probe through this module.
export { checkFfmpeg };
