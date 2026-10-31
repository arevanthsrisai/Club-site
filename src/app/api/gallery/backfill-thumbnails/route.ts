import { NextResponse } from "next/server";
import { getAdminContext, hasPermission, unauthorized, forbidden } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
    getStorageConfig, getObject, uploadObject, buildGalleryKey,
} from "@/lib/objectStorage";
import { generateVideoThumbnail } from "@/lib/videoThumbnail";

/**
 * Backfill video thumbnails for gallery items uploaded before the
 * thumbnail pipeline existed.
 *
 * Auth: Firebase ID token; caller must hold gallery.manage.
 *
 * Behavior:
 *  - Scans the `gallery` collection for docs where type == "video" and
 *    thumbnailKey is absent, in batches of `batchSize` (default 5, max 10).
 *  - For each, downloads the stored video from B2 by storageKey, extracts a
 *    representative frame with FFmpeg, uploads the JPEG to B2, and writes
 *    thumbnailKey back to the Firestore doc.
 *  - Idempotent: docs that already have thumbnailKey are skipped; a missing
 *    or unreadable video is reported per-item, never fatal to the batch.
 *  - Never deletes, overwrites, or re-encodes the original video object.
 *
 * Response: { processed, succeeded, failed, skipped, results: [...] }.
 * Call repeatedly until `processed === 0` to finish the backlog.
 */
export async function POST(request: Request) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "gallery.manage")) return forbidden("gallery.manage");

    const config = getStorageConfig();
    if (!config) {
        return NextResponse.json({ error: "Gallery object storage is not configured." }, { status: 503 });
    }

    // Optional batch size from the request body (bounded).
    let batchSize = 5;
    try {
        const body = await request.json();
        if (typeof body?.batchSize === "number" && Number.isFinite(body.batchSize)) {
            batchSize = Math.max(1, Math.min(10, Math.floor(body.batchSize)));
        }
    } catch {
        // No body or invalid JSON — use the default.
    }

    const db = getAdminFirestore();
    const snap = await db
        .collection("gallery")
        .where("type", "==", "video")
        .limit(batchSize * 3) // fetch extra so we can skip already-backfilled docs
        .get();

    type ItemStatus = "success" | "skipped" | "failed";
    interface ItemResult {
        id: string;
        status: ItemStatus;
        reason?: string;
    }
    const results: ItemResult[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const push = (id: string, status: ItemStatus, reason?: string) => {
        results.push({ id, status, ...(reason ? { reason } : {}) });
    };

    for (const docSnap of snap.docs) {
        if (succeeded + failed >= batchSize) break; // respect the batch cap
        const data = docSnap.data();
        const id = docSnap.id;

        // Idempotency: already has a thumbnail — skip silently.
        if (data.thumbnailKey) {
            skipped++;
            push(id, "skipped", "thumbnailKey already present");
            continue;
        }

        const storageKey = typeof data.storageKey === "string" ? data.storageKey : "";
        const eventId = typeof data.eventId === "string" ? data.eventId : "";
        if (!storageKey) {
            failed++;
            push(id, "failed", "missing storageKey");
            continue;
        }

        try {
            const obj = await getObject(config, storageKey);
            if (!obj || !obj.body || obj.body.length === 0) {
                failed++;
                push(id, "failed", "video object not found or empty in B2");
                continue;
            }

            const contentType = obj.contentType ?? "video/mp4";
            const thumb = await generateVideoThumbnail(obj.body, contentType);
            if (!thumb) {
                failed++;
                push(id, "failed", "FFmpeg could not extract a frame");
                continue;
            }

            const baseName = storageKey.split("/").pop()?.replace(/\.[^.]+$/, "") || "video";
            const thumbKey = buildGalleryKey(eventId || "unknown", `${baseName}-thumb`, thumb.ext);
            if (!thumbKey) {
                failed++;
                push(id, "failed", "could not build a valid thumbnail key");
                continue;
            }

            await uploadObject(config, thumbKey, thumb.data, thumb.contentType);
            await docSnap.ref.update({ thumbnailKey: thumbKey });
            succeeded++;
            push(id, "success");
        } catch (error) {
            failed++;
            push(id, "failed", error instanceof Error ? error.message : "unexpected error");
        }
    }

    return NextResponse.json({
        processed: succeeded + failed,
        succeeded,
        failed,
        skipped,
        results,
        hasMore: snap.docs.length >= batchSize * 3,
    });
}
