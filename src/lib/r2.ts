import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

/**
 * Cloudflare R2 (S3-compatible) object storage for the event gallery.
 *
 * Required environment variables (documented in .env.example):
 *   R2_ACCOUNT_ID        Cloudflare account id
 *   R2_ACCESS_KEY_ID     R2 token access key (least-privilege, gallery bucket only)
 *   R2_SECRET_ACCESS_KEY R2 token secret
 *   R2_BUCKET_NAME       dedicated gallery bucket
 *   R2_PUBLIC_BASE_URL   public delivery base (custom domain or the bucket's
 *                        managed r2.dev domain), no trailing slash
 *
 * Objects are stored unmodified (no transcoding/downscaling) so the uploaded
 * file is always the source of truth. Delivery is CDN-cacheable via immutable
 * unique keys (uuid naming => re-PUT of the same key never happens).
 */

const ENV_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_BASE_URL"] as const;

export interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    publicBaseUrl: string;
}

/** R2_CONFIGURED is intentionally a constant so client bundles never adapt behavior to secrets. */
export const R2_ENV_KEYS = ENV_KEYS;

/** Returns the effective R2 config, or null when any required variable is missing/incomplete. */
export function getR2Config(): R2Config | null {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicBaseUrl) return null;
    // Sanity: the base URL must be an https URL we control, never a relative attacker-controlled path.
    try {
        const url = new URL(publicBaseUrl);
        if (url.protocol !== "https:") return null;
    } catch {
        return null;
    }
    return { accountId, accessKeyId, secretAccessKey, bucketName, publicBaseUrl };
}

function getR2Client(config: R2Config): S3Client {
    return new S3Client({
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
}

export type GalleryMediaType = "image" | "video" | "pdf";

export const MAX_GALLERY_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB — generous but bounded

/**
 * Sniff the actual file content from magic bytes; never trust the browser's MIME type.
 * Returns { type, contentType } or null for unsupported content.
 */
export function sniffMedia(buf: Uint8Array, browserType: string): { type: GalleryMediaType; contentType: string } | null {
    const startsWith = (arr: number[]) => arr.every((b, i) => buf[i] === b);
    const asciiAt = (i: number, s: string) => s.startsWith(String.fromCharCode(...buf.slice(i, i + s.length)));

    if (startsWith([0xff, 0xd8, 0xff])) return { type: "image", contentType: "image/jpeg" };
    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image", contentType: "image/png" };
    if (startsWith([0x47, 0x49, 0x46, 0x38])) return { type: "image", contentType: "image/gif" };
    if (startsWith([0x52, 0x49, 0x46, 0x46]) && asciiAt(8, "WEBP")) return { type: "image", contentType: "image/webp" };
    if (startsWith([0x1b, 0x29, 0x43, 0x3a])) return { type: "image", contentType: "image/avif" };
    if (asciiAt(4, "ftyp")) return { type: "video", contentType: "video/mp4" };
    if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return { type: "video", contentType: "video/webm" };
    if (startsWith([0x25, 0x50, 0x44, 0x46])) return { type: "pdf", contentType: "application/pdf" };
    return null;
}

/**
 * Builds a safe, unique object key. Restricts the base path, strips traversal
 * characters from the filename, and always ends with a uuid so distinct
 * uploads never share a cache key.
 */
export function buildGalleryKey(eventId: string, filename: string, ext: string): string | null {
    if (!/^[\w-]{1,64}$/.test(eventId)) return null; // Firestore doc ids are [A-Za-z0-9-_]
    const safeName = filename.replace(/[^\w.-]+/g, "-").slice(0, 80).replace(/^[.-]+/, "") || "file";
    return `gallery/${eventId}/${randomUUID()}-${safeName}${ext}`;
}

export function validateGalleryKey(key: string): boolean {
    // Only allow deletion of objects inside our gallery/ prefix.
    return /^gallery\/[\w-]{1,64}\/[\w.-]+$/.test(key);
}

/** Uploads the object unchanged and returns its public delivery URL. */
export async function uploadToR2(config: R2Config, key: string, body: Buffer, contentType: string): Promise<string> {
    const client = getR2Client(config);
    await client.send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
    }));
    return `${config.publicBaseUrl}/${key}`;
}

export async function deleteFromR2(config: R2Config, key: string): Promise<void> {
    const client = getR2Client(config);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

/**
 * Losslessly recompresses image bytes where a lossless format helps:
 * PNG (and AVIF/TIFF inputs) are re-encoded as WebP lossless — pixel-identical
 * output, typically 40-60% smaller on disk. JPEG and everything else is
 * returned untouched because re-encoding lossy formats cannot be done without
 * quality loss, and the user asked for none.
 *
 * Returns the best of { original bytes, lossless WebP } by absolute file size,
 * plus its content type and the extension that goes into the object key.
 */
export async function losslesslyOptimize(
    body: Buffer,
    contentType: string,
): Promise<{ data: Buffer; contentType: string; ext: string }> {
    const pngLike = contentType === "image/png" || contentType === "image/avif" || contentType === "image/tiff";
    if (!pngLike) return { data: body, contentType, ext: extFor(contentType) };

    try {
        const sharp = (await import("sharp")).default;
        const lossless = await sharp(body)
            .webp({ lossless: true, effort: 4 })
            .toBuffer();
        if (lossless.length < body.length) {
            return { data: lossless, contentType: "image/webp", ext: extFor("image/webp") };
        }
    } catch (error) {
        // Recoding is an optimization, never a gate: fall back to the original bytes on any failure.
        console.warn("Lossless WebP optimization skipped:", error);
    }
    return { data: body, contentType, ext: extFor(contentType) };
}

export function extFor(contentType: string): string {
    switch (contentType) {
        case "image/jpeg": return ".jpg";
        case "image/png": return ".png";
        case "image/gif": return ".gif";
        case "image/webp": return ".webp";
        case "image/avif": return ".avif";
        case "video/mp4": return ".mp4";
        case "video/webm": return ".webm";
        case "application/pdf": return ".pdf";
        default: return "";
    }
}

export async function headR2Object(config: R2Config, key: string): Promise<{ contentLength?: number; contentType?: string } | null> {
    try {
        const client = getR2Client(config);
        const res = await client.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }));
        return { contentLength: res.ContentLength, contentType: res.ContentType };
    } catch {
        return null;
    }
}
