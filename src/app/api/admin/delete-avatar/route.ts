import { NextResponse } from 'next/server';
import { getAdminContext, unauthorized, forbidden } from '@/lib/serverAuthz';
import { getStorageConfig, deleteObjectPermanent } from '@/lib/objectStorage';
import { validateKey, validateLegacyRootKey } from '@/lib/storageValidation';

export const dynamic = 'force-dynamic';

/**
 * Deletes a profile avatar from B2.
 *
 * Auth: Firebase ID token required; caller must be an approved admin.
 * The key is validated against our B2 namespace before any deletion attempt.
 */
export async function POST(request: Request) {
    // Server-side authorization: verified approved admin, same bar as before.
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!ctx.isAdmin) return forbidden('admin profile required');

    const config = getStorageConfig();
    if (!config) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const key = typeof body?.key === 'string' ? body.key : '';
    // Accept both namespaced keys and legacy root-level keys
    if (!key || (!validateKey(key) && !validateLegacyRootKey(key))) {
        return NextResponse.json({ error: 'Invalid storage key.' }, { status: 400 });
    }

    // Use permanent deletion to remove all versions when bucket versioning is enabled.
    try {
        await deleteObjectPermanent(config, key, true);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ 
            error: 'Delete failed', 
            code: 'PermanentDeleteFailed' 
        }, { status: 500 });
    }
}