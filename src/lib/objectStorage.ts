import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { validateKey as validateKeyImpl } from "@/lib/storageValidation";
export { validateKeyImpl as validateKey };

/**
 * S3-compatible object storage for the event gallery.
 *
 * The primary provider is Backblaze B2 (its S3-compatible API). Cloudflare R2
 * is kept as a legacy provider so existing R2 objects can still be deleted and
 * served while they are being migrated; configure B2 and R2 falls away.
 *
 * Required environment variables (documented in .env.example):
 *
 * B2 (primary):
 *   B2_S3_ENDPOINT        S3 endpoint from the bucket's details, e.g.
 *                         https://s3.us-west-004.backblazeb2.com (no guess — read it)
 *   B2_REGION             region/subdomain part, e.g. us-west-004
 *   B2_BUCKET_NAME        dedicated gallery bucket
 *   B2_APPLICATION_KEY_ID application key ID (least-privilege key)
 *   B2_APPLICATION_KEY    the application key secret (never exposed client-side)
 *
 * Legacy R2 (during migration only):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
 *   R2_PUBLIC_BASE_URL
 *
 * B2 buckets are private: gallery media is delivered through the same-origin
 * server route /api/gallery/media (see route), which reads the object with the
 * server-side client and attaches proper cache/content-type headers. Object
 * keys are uuid-unique so "immutable" browser caching is always safe.
 */

export type StorageProvider = "b2" | "r2";

export interface StorageConfig {
    provider: StorageProvider;
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    /** Legacy R2-only public delivery base; null for B2 (private-bucket delivery goes through /api/gallery/media). */
    publicBaseUrl: string | null;
}

const B2_ENV_KEYS = ["B2_S3_ENDPOINT", "B2_REGION", "B2_BUCKET_NAME", "B2_APPLICATION_KEY_ID", "B2_APPLICATION_KEY"] as const;
const LEGACY_R2_ENV_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_BASE_URL"] as const;

/** Exported only for tests: the module has no other reason to expose its key names. */
export const STORAGE_ENV_KEYS = { b2: B2_ENV_KEYS, legacyR2: LEGACY_R2_ENV_KEYS };

function getLegacyR2Config(): StorageConfig | null {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicBaseUrl) return null;
    try {
        const url = new URL(publicBaseUrl);
        if (url.protocol !== "https:") return null;
    } catch {
        return null;
    }
    return {
        provider: "r2",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        accessKeyId,
        secretAccessKey,
        bucketName,
        publicBaseUrl,
    };
}

function getB2Config(): StorageConfig | null {
    const endpoint = process.env.B2_S3_ENDPOINT?.replace(/\/+$/, "");
    const region = process.env.B2_REGION;
    const bucketName = process.env.B2_BUCKET_NAME;
    const accessKeyId = process.env.B2_APPLICATION_KEY_ID;
    const secretAccessKey = process.env.B2_APPLICATION_KEY;
    if (!endpoint || !region || !bucketName || !accessKeyId || !secretAccessKey) return null;
    try {
        const url = new URL(endpoint);
        if (url.protocol !== "https:") return null;
    } catch {
        return null;
    }
    return { provider: "b2", endpoint, region, accessKeyId, secretAccessKey, bucketName, publicBaseUrl: null };
}

/** B2 wins when both are configured (the R2 vars are only a carve-out for legacy objects). */
export function getStorageConfig(): StorageConfig | null {
    return getB2Config() ?? getLegacyR2Config();
}

function getClient(config: StorageConfig): S3Client {
    return new S3Client({
        region: config.provider === "b2" ? config.region : "auto",
        endpoint: config.endpoint,
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
    const asciiAt = (i: number, s: string) => buf.length >= i + s.length && s === String.fromCharCode(...buf.slice(i, i + s.length));

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
    // Only allow access to objects inside our gallery/ prefix.
    return /^gallery\/[\w-]{1,64}\/[\w.-]+$/.test(key);
}

/** Uploads the object unchanged and returns its public delivery URL. */
export async function uploadObject(config: StorageConfig, key: string, body: Buffer, contentType: string): Promise<string> {
    if (!body || body.length === 0) {
        throw new Error("Cannot upload a zero-byte object");
    }
    const client = getClient(config);
    await client.send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
    }));
    if (config.publicBaseUrl) return `${config.publicBaseUrl}/${key}`;
    // Private-bucket delivery (B2): served through the same-origin media route,
    // which validates the key and streams the object with correct headers.
    return `/api/gallery/media?key=${encodeURIComponent(key)}`;
}



export async function deleteObjectPermanent(config: StorageConfig, key: string, _force = false): Promise<void> {
    const client = getClient(config);
    // List all versions (including delete markers) for the exact key.
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let hasMore = true;
    const toDelete: { Key: string; VersionId: string }[] = [];
    while (hasMore) {
        const res = await client.send(new ListObjectVersionsCommand({
            Bucket: config.bucketName,
            Prefix: key,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
        }));
        for (const v of res.Versions ?? []) {
            if (v.Key === key && v.VersionId) toDelete.push({ Key: key, VersionId: v.VersionId });
        }
        for (const dm of res.DeleteMarkers ?? []) {
            if (dm.Key === key && dm.VersionId) toDelete.push({ Key: key, VersionId: dm.VersionId });
        }
        hasMore = !!res.IsTruncated;
        keyMarker = res.NextKeyMarker;
        versionIdMarker = res.NextVersionIdMarker;
    }
    // Delete each version (this is what actually removes stored bytes on B2).
    for (const item of toDelete) {
        try {
            await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: item.Key, VersionId: item.VersionId }));
        } catch (e) {
            console.error("version delete failed", item, e);
            throw e;
        }
    }
    // Legacy-provider-only plain delete. On Backblaze B2 the S3-compatible
    // DeleteObject NEVER erases data: it creates a permanent "hide marker"
    // that is invisible to every object listing yet shows up in the B2 web
    // console as an immortal "0 bytes" ghost row — even for keys that never
    // existed or whose versions were just removed above. Every real byte was
    // already deleted by the version loop, so on B2 we stop here and the
    // console stays clean. Legacy unversioned providers (R2) still need the
    // plain delete because they have no version traversal.
    if (config.provider !== "b2") {
        try {
            await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
        } catch (e) {
            console.warn("plain delete failed", e);
        }
    }
}

export async function deleteObject(config: StorageConfig, key: string): Promise<void> {
    const client = getClient(config);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

/**
 * Streams the stored object bytes for the /api/gallery/media delivery route.
 * `rangeHeader`, when given (e.g. "bytes=0-1023"), is passed straight through
 * to the S3-compatible provider so video clients can seek; the returned Buffer
 * is exactly the requested slice.
 */
export async function getObject(
    config: StorageConfig,
    key: string,
    rangeHeader?: string,
): Promise<{ body: Buffer; contentType?: string } | null> {
    try {
        const client = getClient(config);
        const res = await client.send(
            new GetObjectCommand({
                Bucket: config.bucketName,
                Key: key,
                ...(rangeHeader ? { Range: rangeHeader } : {}),
            })
        );
        if (!res.Body) return null;
        const bytes = await res.Body.transformToByteArray();
        return { body: Buffer.from(bytes), contentType: res.ContentType ?? undefined };
    } catch {
        return null;
    }
}

export async function headObject(config: StorageConfig, key: string): Promise<{ contentLength?: number; contentType?: string } | null> {
    try {
        const client = getClient(config);
        const res = await client.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }));
        return { contentLength: res.ContentLength, contentType: res.ContentType };
    } catch {
        return null;
    }
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
        if (lossless.length > 0 && lossless.length < body.length) {
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
