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
