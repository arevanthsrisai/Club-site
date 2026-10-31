/**
 * Client-side upload helper: sends any approved-namespace media file to the
 * secure server route /api/media/upload (admin-token verified, object keys
 * server-generated, Backblaze B2 via the server-side S3 client).
 *
 * This is the ONLY upload path for profiles, team profiles, event images,
 * covers, resources and avatars — Firebase Storage is not used for new media
 * (see docs/gallery-migration.md). When the server has no object store
 * configured the route replies 503 and this helper surfaces a precise,
 * actionable error instead of silently uploading somewhere else.
 *
 * The returned URL is always a same-origin `/api/gallery/media?key=...`
 * delivery link; B2 credentials never reach the browser.
 */
export interface MediaUploadResult {
    url: string;
    key: string;
}

export async function uploadMedia(
    file: File,
    path: string,
    onProgress?: (pct: number) => void,
): Promise<MediaUploadResult> {
    const { getAuthToken } = await import("@/lib/authHeaders");
    const token = await getAuthToken();
    if (!token) throw new Error("Not signed in — sign in again to upload.");

    return new Promise<MediaUploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const data = new FormData();
        data.append("file", file);
        data.append("path", path);

        xhr.open("POST", "/api/media/upload");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (onProgress) {
            xhr.upload.onprogress = (e) =>
                e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
        }
        xhr.onload = () => {
            let json: { url?: string; key?: string; error?: string } = {};
            try {
                json = JSON.parse(xhr.responseText || "{}");
            } catch {
                /* handled below by status check */
            }
            if (xhr.status >= 200 && xhr.status < 300 && json.url && json.key) {
                resolve({ url: json.url, key: json.key });
            } else if (xhr.status === 503) {
                reject(new Error("Object storage is not configured on the server. Ask the CTO to set the B2_* environment variables (B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY) and restart."));
            } else {
                reject(new Error(json.error || `Upload failed (${xhr.status})`));
            }
        };
        xhr.onerror = () => reject(new Error("Upload failed — network error."));
        xhr.send(data);
    });
}
