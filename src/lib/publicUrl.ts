/** Stored URLs become links only when they are real http(s) URLs.
 *  Shared by browser components (MemberModal) AND server API routes, so it
 *  must not import anything from React or firebase. */
export function safeHttpUrl(raw: string | undefined | null): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

/**
 * Photo/media URLs may be either absolute http(s) URLs or same-origin
 * relative delivery paths (e.g. "/api/gallery/media?key=..."). The media
 * upload route returns a relative path, so photo fields must accept it.
 */
export function safePhotoUrl(raw: string | undefined | null): string | null {
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    if (value.startsWith("/")) {
        // Same-origin relative path: reject anything that could escape the origin.
        if (value.includes("://") || value.includes("\\")) return null;
        return value;
    }
    return safeHttpUrl(value);
}
