/**
 * Client-safe storage key validation.
 *
 * This module contains NO imports from @aws-sdk/client-s3, sharp, or any
 * Node-only package. It can be safely imported by client components.
 */

/**
 * Regex for approved B2 object-key prefixes.
 *
 * Canonical format: {namespace}/{[ownerId]/}{uuid}-{safeName}.{ext}
 * Accepts an optional leading slash for backward compatibility with
 * legacy keys that were written with a leading slash during the
 * previous migration phase.
 */
const B2_KEY_RE = /^\/?(gallery|avatars|profiles|team_profiles|resources|event-images|event-covers|resource-thumbnails)\/([\w-]{1,64}\/)?[\w.-]+$/;

/**
 * Validates that a key belongs to our application's B2 namespace.
 * Pure function — no server-side dependencies.
 */
export function validateKey(key: string): boolean {
    if (!key) return false;
    return B2_KEY_RE.test(key);
}

/**
 * Validates legacy root-level keys (UUID format) for cleanup operations.
 *
 * This is used ONLY for cleaning up orphaned objects from the migration era.
 * New uploads are never allowed at the root level.
 *
 * Pattern: /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}-[\w.-]+$/
 */
export function validateLegacyRootKey(key: string): boolean {
    if (!key) return false;
    return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}-[\w.-]+$/.test(key);
}