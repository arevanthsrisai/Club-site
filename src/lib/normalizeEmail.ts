/**
 * Email normalization for the ReLU Club.
 *
 * All account-creation paths must normalize before touching Firebase Auth or
 * Firestore. Firebase Auth's `email-already-in-use` is case-insensitive, but
 * our own Firestore lookups are not, so a single shared helper keeps every
 * write and every query consistent.
 */

/** Trim whitespace and lowercase. Returns null for unusable input. */
export function normalizeEmail(raw: string | null | undefined): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    return trimmed.toLowerCase();
}