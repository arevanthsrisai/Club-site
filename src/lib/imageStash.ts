/**
 * Image Stash — shared contracts and pure helpers.
 *
 * The stash is an index over the existing Backblaze B2 media store, not a new
 * provider. Every asset keeps its bytes under the approved `image-stash/`
 * namespace and is delivered through a stable, friendly same-origin URL:
 *
 *   /api/images/{assetId}
 *
 * That URL is what gets stored on alumni profiles (and any other admin-managed
 * content). Because the ID is stable, replacing the bytes behind an asset
 * keeps every existing reference working. The raw B2 key never becomes the
 * source of truth, and credentials never reach the browser.
 *
 * This module has no Node/Firebase imports so it is safe in client components
 * and directly unit-testable.
 */

import type { StoredImage } from "@/types";

/** Approved B2 namespace for stash uploads. */
export const IMAGE_STASH_NAMESPACE = "image-stash";

/** Firestore collection holding the asset index. */
export const IMAGE_ASSET_COLLECTION = "image_assets";

/** Same 25 MB bound as the rest of media storage. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Public delivery URL for an asset. Stable for the life of the asset. */
export function friendlyImageUrl(assetId: string): string {
    return `/api/images/${assetId}`;
}

/** Asset IDs are server-generated UUIDs; anything else is rejected. */
export function isAssetId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

/**
 * Turns a user-supplied filename into a safe object-key segment. The extension
 * is dropped here and re-derived from the sniffed content type at upload time.
 */
export function sanitizeImageName(name: unknown): string {
    const raw = typeof name === "string" ? name : "";
    // Strip a real extension; a dotfile like ".hidden" keeps its name.
    const withoutExt = raw.replace(/\.[^./\\]+$/, "") || raw.replace(/^\.+/, "");
    const safe = withoutExt
        .replace(/[^\w.-]+/g, "-")
        .replace(/^[.-]+/, "")
        .slice(0, 60);
    return safe || "image";
}

/** Human filename for display, derived from a URL when no name was recorded. */
export function filenameFromUrl(url: unknown): string {
    if (typeof url !== "string" || !url) return "image";
    try {
        const parsed = new URL(url, "http://localhost");
        const key = parsed.searchParams.get("key");
        const path = key || parsed.pathname;
        const base = path.split("/").filter(Boolean).pop() || "image";
        return decodeURIComponent(base);
    } catch {
        return "image";
    }
}

/**
 * Extracts the object key from a `/api/gallery/media?key=…` URL (or returns a
 * bare key unchanged). Used when indexing images that predate the stash.
 */
export function extractStorageKey(urlOrKey: unknown): string | null {
    if (typeof urlOrKey !== "string" || !urlOrKey) return null;
    if (!urlOrKey.includes("?") && !/^https?:\/\//i.test(urlOrKey)) return urlOrKey;
    try {
        const parsed = new URL(urlOrKey, "http://localhost");
        return parsed.searchParams.get("key");
    } catch {
        return null;
    }
}

/** Same-origin delivery URL used by the legacy gallery media route. */
export function galleryMediaUrl(key: string): string {
    return `/api/gallery/media?key=${encodeURIComponent(key)}`;
}

/**
 * Every string that could appear in stored content when it points at this
 * asset. Reference checks compare against all of them so an asset cannot be
 * deleted while a profile still renders it.
 */
export function assetReferenceCandidates(asset: Pick<StoredImage, "id" | "key">): string[] {
    const candidates = new Set<string>();
    candidates.add(friendlyImageUrl(asset.id));
    if (asset.key) {
        candidates.add(asset.key);
        candidates.add(galleryMediaUrl(asset.key));
        // Stored values are sometimes decoded by hand; accept both spellings.
        candidates.add(`/api/gallery/media?key=${asset.key}`);
    }
    return [...candidates];
}

/** True when a stored image value points at an asset in the stash. */
export function assetIdFromUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const match = value.match(/^\/api\/images\/([A-Za-z0-9_-]{8,64})(?:[?#].*)?$/);
    return match ? match[1] : null;
}

/** Short display size, e.g. "1.4 MB". */
export function formatBytes(bytes: number | null | undefined): string {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const rounded = Number.isInteger(value) || value >= 10 || unit === 0
        ? String(Math.round(value))
        : value.toFixed(1);
    return `${rounded} ${units[unit]}`;
}

/** Date filter options offered by the Image Stash. */
export type ImageDateFilter = "all" | "7d" | "30d";

export function createdWithin(dateFilter: ImageDateFilter, createdAt: unknown, now = Date.now()): boolean {
    if (dateFilter === "all") return true;
    const millis = toMillis(createdAt);
    if (millis === null) return false;
    const days = dateFilter === "7d" ? 7 : 30;
    return now - millis <= days * 24 * 60 * 60 * 1000;
}

function toMillis(value: unknown): number | null {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
        return (value as { toMillis: () => number }).toMillis();
    }
    if (typeof (value as { seconds?: number }).seconds === "number") {
        return (value as { seconds: number }).seconds * 1000;
    }
    return null;
}

/** Search matches filename, friendly URL, key or source URL. */
export function matchesImageSearch(asset: StoredImage, term: string): boolean {
    const needle = term.trim().toLowerCase();
    if (!needle) return true;
    return [asset.filename, asset.url, asset.key, asset.sourceUrl]
        .filter((v): v is string => typeof v === "string")
        .some(v => v.toLowerCase().includes(needle));
}

/** A raw 64-char SHA-256 hex digest, used to avoid duplicate assets. */
export function isSha256Hex(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
