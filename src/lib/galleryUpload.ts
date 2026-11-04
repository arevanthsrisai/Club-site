/**
 * Client-side gallery media upload: one file → Backblaze B2 through the
 * admin-token server route (/api/gallery/upload), with per-file progress.
 *
 * There is intentionally NO fallback to Firebase Storage: if the server has no
 * object store configured it answers 503 and this helper rejects with that
 * exact actionable error, so the UI can stop the batch instead of silently
 * writing media to the wrong provider.
 */
export interface VideoProcessingInfo {
    processingStatus: "done" | "partial";
    processingError?: string;
}

export interface UploadOutcome extends VideoProcessingInfo {
    /** Same-origin delivery URL (/api/gallery/media?key=…) */
    url: string;
    /** Server-generated object key (gallery/<eventId>/<uuid>-<name><ext>) */
    key: string;
    storedSize?: number;
    /** Video-only extras */
    thumbnailKey?: string;
    originalKey?: string;
}

export function isVideoProcessingOutcome(v: UploadOutcome): boolean {
    return typeof (v as { thumbnailKey?: string }).thumbnailKey === "string" || !!v.processingError;
}

/**
 * Uploads one gallery file. `onProgress` reports 0-100 for the byte transfer;
 * Firestore metadata persistence happens separately in the caller (the queue's
 * "saving" state), matching the tests' lifecycle contract.
 */
export async function uploadGalleryMedia(
    file: File,
    eventId: string,
    onProgress?: (pct: number) => void,
): Promise<UploadOutcome> {
    const { getAuthToken } = await import("@/lib/authHeaders");
    const token = await getAuthToken();
    if (!token) throw new Error("Not signed in — sign in again to upload.");

    return new Promise<UploadOutcome>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const data = new FormData();
        data.append("file", file);
        data.append("eventId", eventId);

        xhr.open("POST", "/api/gallery/upload");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (onProgress) {
            xhr.upload.onprogress = (e) =>
                e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
        }
        xhr.onload = () => {
            let json: (Partial<UploadOutcome> & { error?: string }) = {};
            try {
                json = JSON.parse(xhr.responseText || "{}");
            } catch {
                /* fall through to the status branch */
            }
            if (xhr.status >= 200 && xhr.status < 300 && json.url && json.key) {
                resolve({
                    url: json.url,
                    key: json.key,
                    storedSize: json.storedSize,
                    processingStatus: json.processingStatus === "partial" ? "partial" : "done",
                    processingError: json.processingError,
                    thumbnailKey: json.thumbnailKey,
                    originalKey: json.originalKey,
                });
            } else if (xhr.status === 503) {
                reject(new Error("Gallery object storage is not configured. Set the B2_* environment variables (B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY) and restart the server."));
            } else {
                reject(new Error(json.error || `Upload failed (${xhr.status})`));
            }
        };
        xhr.onerror = () => reject(new Error("Upload failed — network error"));
        xhr.send(data);
    });
}

/** One-shot capability check so the UI knows whether uploads are available. */
export async function checkStorageConfigured(): Promise<{
    storageConfigured: boolean;
    provider?: "b2" | null;
    missingKeys?: string[];
}> {
    const { getAuthHeaders } = await import("@/lib/authHeaders");
    const headers = await getAuthHeaders();
    if (!headers) return { storageConfigured: false };
    try {
        const res = await fetch("/api/gallery/status", { headers });
        if (!res.ok) return { storageConfigured: false };
        return await res.json();
    } catch {
        return { storageConfigured: false };
    }
}
