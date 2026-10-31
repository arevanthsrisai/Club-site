import { NextResponse } from 'next/server';
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from '@/lib/serverAuthz';
import { getStorageConfig, deleteObjectPermanent } from '@/lib/objectStorage';
import { validateKey, validateLegacyRootKey } from '@/lib/storageValidation';

export const dynamic = 'force-dynamic';

/** Extract the object key from a media delivery URL or return the raw string if it's already a key. */
function extractKey(urlOrKey: string): string | null {
    if (!urlOrKey) return null;
    // If it looks like a key already (no protocol, no query params), return as-is
    if (!urlOrKey.includes('?') && !urlOrKey.startsWith('http')) {
        return urlOrKey;
    }
    // Try to extract key from /api/gallery/media?key=...
    try {
        const parsed = new URL(urlOrKey.startsWith('http') ? urlOrKey : `http://localhost${urlOrKey}`);
        const key = parsed.searchParams.get('key');
        if (key) return key;
    } catch {
        // Not a valid URL, fall through
    }
    return urlOrKey;
}

/**
 * Validates a storage key for deletion. Accepts both:
 * 1. Namespaced keys (gallery/, profiles/, etc.) — the standard format
 * 2. Legacy root-level UUID keys — for cleanup of pre-migration objects
 *
 * Legacy keys are only accepted for backward compatibility during the
 * migration cleanup phase. New uploads must use namespaced keys.
 */
function validateDeletionKey(key: string): boolean {
    // Standard namespaced keys
    if (validateKey(key)) return true;
    // Legacy root-level UUID keys (cleanup only)
    if (validateLegacyRootKey(key)) return true;
    return false;
}

/**
 * Sanitized key for logging — strips sensitive path details.
 */
function sanitizeKeyForLog(key: string): string {
    // Log only the prefix, not the full key
    const parts = key.split('/');
    if (parts.length >= 2) return `${parts[0]}/...`;
    return '[legacy-root-key]';
}

/**
 * Deletes an arbitrary B2 object by its delivery URL or key.
 *
 * Auth: Firebase ID token required; caller must be an approved admin.
 * The key is validated against our B2 namespace regex before any deletion
 * attempt. Accepts both namespaced keys and legacy root-level UUID keys
 * (for migration cleanup).
 */
export async function POST(request: Request) {
    // Server-side authorization: the caller must manage the media namespace the
    // key belongs to (gallery or resources). The CTO holds both always.
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    const mediaPerms = ['gallery.manage', 'resources.manage'];
    if (!mediaPerms.some(p => hasPermission(ctx, p))) return forbidden('gallery.manage | resources.manage');

    const config = getStorageConfig();
    if (!config) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    
    // Accept either 'url' or 'key' parameter
    const urlOrKey = typeof body?.url === 'string' ? body.url : (typeof body?.key === 'string' ? body.key : '');
    const key = extractKey(urlOrKey);
    
    if (!key || !validateDeletionKey(key)) {
        console.warn('Deletion rejected: invalid key', { uid: ctx.uid, keyPrefix: sanitizeKeyForLog(urlOrKey || '') });
        return NextResponse.json({ error: 'Invalid storage key.' }, { status: 400 });
    }

    console.log('B2 deletion requested', { uid: ctx.uid, keyPrefix: sanitizeKeyForLog(key) });
    // Use permanent deletion to remove all versions when bucket versioning is enabled.
    try {
        await deleteObjectPermanent(config, key, true);
        await logServerActivity(ctx.uid, ctx.name, 'DELETE_STORED_OBJECT', { keyPrefix: sanitizeKeyForLog(key) });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('B2 deletion failed', { uid: ctx.uid, keyPrefix: sanitizeKeyForLog(key) });
        return NextResponse.json({ error: 'Deletion from storage failed.', code: 'PermanentDeleteFailed' }, { status: 500 });
    }
}
