/**
 * Tests for the B2 deletion validation logic.
 *
 * Replicates the regex patterns from src/lib/objectStorage.ts and
 * src/lib/storageValidation.ts so they can be verified at runtime.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

/* --- Re-create the validators inline (mirrors source) --- */

// src/lib/storageValidation.ts — B2_KEY_RE
const B2_KEY_RE = /^\/?(gallery|avatars|profiles|team_profiles|resources|event-images|event-covers|resource-thumbnails)\/([\w-]{1,64}\/)?[\w.-]+$/;

function validateKeyClientSafe(key) {
    if (!key) return false;
    return B2_KEY_RE.test(key);
}

// src/lib/objectStorage.ts — validateGalleryKey (identical regex)
function validateGalleryKey(key) {
    return /^\/?(gallery|avatars|profiles|team_profiles|resources|event-images|event-covers|resource-thumbnails)\/([\w-]{1,64}\/)?[\w.-]+$/.test(key);
}

// src/lib/objectStorage.ts — validateKey aliases validateGalleryKey
function validateKey(key) {
    return validateGalleryKey(key);
}

// src/lib/objectStorage.ts — validateLegacyRootKey
function validateLegacyRootKey(key) {
    return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}-[\w.-]+$/.test(key);
}

// src/app/api/admin/delete-b2/route.ts — extractKey
function extractKey(urlOrKey) {
    if (!urlOrKey) return null;
    if (!urlOrKey.includes('?') && !urlOrKey.startsWith('http')) {
        return urlOrKey;
    }
    try {
        const parsed = new URL(urlOrKey.startsWith('http') ? urlOrKey : `http://localhost${urlOrKey}`);
        const key = parsed.searchParams.get('key');
        if (key) return key;
    } catch { /* fall through */ }
    return urlOrKey;
}

// src/services/storage.ts — deleteFileByUrlIfValid (simplified)
async function deleteFileByUrlIfValid(url, token) {
    if (!url) return { ok: false, reason: 'no-url' };
    if (url.includes('firebasestorage.googleapis.com')) {
        return { ok: false, reason: 'not-b2-url' };
    }
    /* In production, this fetches /api/admin/delete-b2 with body: { url } */
    return { wouldDelete: url, token: token ? 'present' : 'absent' };
}

/* === Tests === */

describe('validateGalleryKey (server-side, namespaced only)', () => {
    it('accepts valid gallery keys', () => {
        assert.strictEqual(validateGalleryKey('gallery/event123/uuid-name.jpg'), true);
        assert.strictEqual(validateGalleryKey('gallery/abc/06bebf1e-...-moon-at-night.mp4'), true);
    });

    it('accepts valid profile keys', () => {
        assert.strictEqual(validateGalleryKey('profiles/uuid-name.jpg'), true);
        assert.strictEqual(validateGalleryKey('profiles/user123/avatar.png'), true);
    });

    it('accepts valid avatar keys', () => {
        assert.strictEqual(validateGalleryKey('avatars/uuid-name.jpg'), true);
    });

    it('accepts all approved namespaces', () => {
        assert.strictEqual(validateGalleryKey('team_profiles/uuid.png'), true);
        assert.strictEqual(validateGalleryKey('resources/uuid-doc.pdf'), true);
        assert.strictEqual(validateGalleryKey('event-images/uuid.jpg'), true);
        assert.strictEqual(validateGalleryKey('event-covers/uuid.png'), true);
        assert.strictEqual(validateGalleryKey('resource-thumbnails/uuid.jpg'), true);
    });

    it('rejects legacy root-level keys (orphaned file format)', () => {
        assert.strictEqual(validateGalleryKey('06bebf1e-1234-5678-9abc-def012345678-moon-at-night.mp4'), false);
        assert.strictEqual(validateGalleryKey('08b10d8f-abcd-ef01-2345-6789abcdef01-presentation.pptx.webp'), false);
        assert.strictEqual(validateGalleryKey('4173a858-9876-5432-1fed-cba987654321-harry_1.mp4'), false);
    });

    it('rejects traversal and arbitrary keys', () => {
        assert.strictEqual(validateGalleryKey('../etc/passwd'), false);
        assert.strictEqual(validateGalleryKey('random-bucket-key'), false);
        assert.strictEqual(validateGalleryKey(''), false);
    });

    it('accepts keys with optional leading slash', () => {
        assert.strictEqual(validateGalleryKey('/gallery/event123/uuid-name.jpg'), true);
        assert.strictEqual(validateGalleryKey('/profiles/uuid-name.jpg'), true);
    });
});

describe('validateLegacyRootKey (cleanup-only)', () => {
    it('accepts legacy root-level UUID keys', () => {
        assert.strictEqual(validateLegacyRootKey('06bebf1e-1234-5678-9abc-def012345678-moon-at-night.mp4'), true);
        assert.strictEqual(validateLegacyRootKey('08b10d8f-abcd-ef01-2345-6789abcdef01-presentation.pptx.webp'), true);
        assert.strictEqual(validateLegacyRootKey('4173a858-9876-5432-1fed-cba987654321-harry_1.mp4'), true);
    });

    it('rejects namespaced keys', () => {
        assert.strictEqual(validateLegacyRootKey('gallery/event123/uuid-name.jpg'), false);
        assert.strictEqual(validateLegacyRootKey('profiles/uuid-name.jpg'), false);
    });

    it('rejects invalid formats', () => {
        assert.strictEqual(validateLegacyRootKey('not-a-uuid-name.jpg'), false);
        assert.strictEqual(validateLegacyRootKey(''), false);
    });
});

describe('validateKey (server-side aliases validateGalleryKey)', () => {
    it('accepts namespaced keys', () => {
        assert.strictEqual(validateKey('gallery/event123/uuid.jpg'), true);
        assert.strictEqual(validateKey('profiles/uuid.jpg'), true);
    });

    it('rejects legacy root-level keys', () => {
        assert.strictEqual(validateKey('06bebf1e-1234-5678-9abc-def012345678-moon.mp4'), false);
    });
});

describe('validateKeyClientSafe (client-side)', () => {
    it('accepts all approved namespaces', () => {
        assert.strictEqual(validateKeyClientSafe('gallery/event123/uuid.jpg'), true);
        assert.strictEqual(validateKeyClientSafe('profiles/uuid.jpg'), true);
        assert.strictEqual(validateKeyClientSafe('avatars/uuid.jpg'), true);
        assert.strictEqual(validateKeyClientSafe('team_profiles/uuid.jpg'), true);
        assert.strictEqual(validateKeyClientSafe('resources/uuid.pdf'), true);
        assert.strictEqual(validateKeyClientSafe('event-images/uuid.jpg'), true);
        assert.strictEqual(validateKeyClientSafe('event-covers/uuid.png'), true);
        assert.strictEqual(validateKeyClientSafe('resource-thumbnails/uuid.jpg'), true);
    });

    it('rejects legacy and invalid keys', () => {
        assert.strictEqual(validateKeyClientSafe('06bebf1e-1234-5678-9abc-def012345678-moon.mp4'), false);
        assert.strictEqual(validateKeyClientSafe('uuid-name.jpg'), false);
        assert.strictEqual(validateKeyClientSafe(''), false);
        assert.strictEqual(validateKeyClientSafe('../etc/passwd'), false);
    });
});

describe('extractKey (delete-b2 route)', () => {
    it('returns raw key when no protocol and no query params', () => {
        assert.strictEqual(extractKey('profiles/uuid-name.jpg'), 'profiles/uuid-name.jpg');
        assert.strictEqual(extractKey('gallery/event123/uuid-name.jpg'), 'gallery/event123/uuid-name.jpg');
    });

    it('extracts key from relative media URL', () => {
        const key = extractKey('/api/gallery/media?key=profiles/uuid-name.jpg');
        assert.strictEqual(key, 'profiles/uuid-name.jpg');
    });

    it('extracts key from absolute media URL', () => {
        const key = extractKey('http://localhost:3000/api/gallery/media?key=profiles/uuid-name.jpg');
        assert.strictEqual(key, 'profiles/uuid-name.jpg');
    });

    it('extracts key with URL-encoded slash', () => {
        // When key contains %2F instead of /, searchParams.get decodes it
        const key = extractKey('/api/gallery/media?key=profiles%2Fuuid-name.jpg');
        assert.strictEqual(key, 'profiles/uuid-name.jpg');
    });

    it('returns input for URLs without key param', () => {
        // A Firebase Storage URL without ?key= — falls through to return as-is
        const result = extractKey('https://firebasestorage.googleapis.com/v0/b/...');
        assert.ok(!result.startsWith('/api/gallery/media'), 'should not be a media URL');
    });

    it('returns null for empty or missing input', () => {
        assert.strictEqual(extractKey(null), null);
        assert.strictEqual(extractKey(''), null);
        assert.strictEqual(extractKey(undefined), null);
    });
});

describe('deleteFileByUrlIfValid (client service)', () => {
    it('returns no-url for falsy input', async () => {
        const r1 = await deleteFileByUrlIfValid(null);
        const r2 = await deleteFileByUrlIfValid(undefined);
        const r3 = await deleteFileByUrlIfValid('');
        assert.strictEqual(r1.reason, 'no-url');
        assert.strictEqual(r2.reason, 'no-url');
        assert.strictEqual(r3.reason, 'no-url');
    });

    it('returns not-b2-url for Firebase Storage URLs', async () => {
        const r = await deleteFileByUrlIfValid('https://firebasestorage.googleapis.com/v0/b/...');
        assert.strictEqual(r.reason, 'not-b2-url');
    });

    it('would send media URL for B2 objects (with auth)', async () => {
        const r = await deleteFileByUrlIfValid('/api/gallery/media?key=profiles/uuid.jpg', 'token123');
        assert.strictEqual(r.wouldDelete, '/api/gallery/media?key=profiles/uuid.jpg');
        assert.strictEqual(r.token, 'present');
    });

    it('would still attempt deletion without auth token', async () => {
        const r = await deleteFileByUrlIfValid('/api/gallery/media?key=profiles/uuid.jpg');
        assert.strictEqual(r.token, 'absent');
    });
});

describe('Integration: full deletion path trace', () => {
    it('traces profile photo deletion end-to-end', () => {
        // Step 1: profile page has photo = "/api/gallery/media?key=profiles/abc123-user.jpg"
        const photo = '/api/gallery/media?key=profiles/abc123-user.jpg';

        // Step 2: deleteFileByUrlIfValid(photo, token) skips Firebase check,
        //         POSTs to /api/admin/delete-b2 with body: { url: photo }
        const wouldSend = { url: photo };
        assert.strictEqual(wouldSend.url, photo);

        // Step 3: /api/admin/delete-b2 extracts key
        const extractedKey = extractKey(wouldSend.url);
        assert.strictEqual(extractedKey, 'profiles/abc123-user.jpg');

        // Step 4: validateKey checks namespace
        assert.strictEqual(validateKey(extractedKey), true);

        // Step 5: deleteObjectFromB2(config, extractedKey) is called
        //         which calls S3 DeleteObjectCommand({ Bucket, Key: extractedKey })
        assert.strictEqual(extractedKey, 'profiles/abc123-user.jpg');
    });

    it('traces gallery deletion end-to-end', () => {
        // Step 1: deleteFromGallery(id) fetches doc, gets storageKey
        const storageKey = 'gallery/event123/uuid-name.jpg';

        // Step 2: POSTs to /api/gallery/delete with body: { key: storageKey }
        const body = { key: storageKey };
        assert.strictEqual(body.key, 'gallery/event123/uuid-name.jpg');

        // Step 3: /api/gallery/delete validates with validateGalleryKey
        assert.strictEqual(validateGalleryKey(body.key), true);

        // Step 4: deleteObject(config, body.key) → DeleteObjectCommand
        assert.strictEqual(body.key, 'gallery/event123/uuid-name.jpg');
    });

    it('traces legacy root-level key rejection by gallery delete', () => {
        // A legacy orphaned file key
        const legacyKey = '06bebf1e-1234-5678-9abc-def012345678-moon-at-night.mp4';

        // Gallery delete route validates with validateGalleryKey — REJECTED
        assert.strictEqual(validateGalleryKey(legacyKey), false);

        // delete-b2 route also uses validateKey (same) — REJECTED
        assert.strictEqual(validateKey(legacyKey), false);

        // delete-avatar route also uses validateKey — REJECTED
        assert.strictEqual(validateKey(legacyKey), false);

        // Only validateLegacyRootKey accepts it (cleanup path)
        assert.strictEqual(validateLegacyRootKey(legacyKey), true);
    });

    it('traces doomsday avatar deletion', () => {
        const uid = 'user123abc';
        const key = `profiles/${uid}`;

        // Doomsday page calls: fetch('/api/admin/delete-avatar', { body: { key } })
        assert.strictEqual(key, 'profiles/user123abc');

        // /api/admin/delete-avatar validates with validateKey
        assert.strictEqual(validateKey(key), true);

        // deleteObjectFromB2(config, key) → DeleteObjectCommand
        assert.ok(key.startsWith('profiles/'));
    });

    it('traces resource deletion with key validation', () => {
        // Resource deletion validates with validateKeyClientSafe BEFORE calling delete-b2
        const b2Url = 'resources/uuid-doc.pdf';
        const firebaseUrl = 'https://firebasestorage.googleapis.com/v0/b/...';

        assert.strictEqual(validateKeyClientSafe(b2Url), true);
        assert.strictEqual(validateKeyClientSafe(firebaseUrl), false);
    });

    it('traces event deletion flow', () => {
        // deleteEvent(id):
        // 1. Fetches all gallery items → deleteFromGallery() for each
        // 2. Calls deleteFileByUrl(eventData.image) → deleteFileByUrlIfValid → delete-b2
        // 3. Deletes event doc

        // Event cover image could be a media URL or raw key
        const coverUrl = '/api/gallery/media?key=event-covers/uuid-cover.jpg';
        const extracted = extractKey(coverUrl);
        assert.strictEqual(extracted, 'event-covers/uuid-cover.jpg');
        assert.strictEqual(validateKey(extracted), true);
    });
});

describe('Security boundaries', () => {
    it('traversal keys are rejected everywhere', () => {
        const traversal = '../secrets/admin.json';
        assert.strictEqual(validateGalleryKey(traversal), false);
        assert.strictEqual(validateKey(traversal), false);
        assert.strictEqual(validateKeyClientSafe(traversal), false);
        assert.strictEqual(validateLegacyRootKey(traversal), false);
    });

    it('random bucket keys are rejected', () => {
        const random = 'some-arbitrary-object-key.txt';
        assert.strictEqual(validateGalleryKey(random), false);
        assert.strictEqual(validateKey(random), false);
        assert.strictEqual(validateKeyClientSafe(random), false);
    });

    it('only approved namespaces pass gallery validation', () => {
        const approved = ['gallery', 'avatars', 'profiles', 'team_profiles',
                          'resources', 'event-images', 'event-covers', 'resource-thumbnails'];
        for (const ns of approved) {
            assert.strictEqual(validateGalleryKey(`${ns}/test-file.jpg`), true,
                `Namespace "${ns}" should be approved`);
        }
    });

    it('unapproved namespaces are rejected', () => {
        const unapproved = ['secrets', 'admins', 'private', 'system', '__proto__', '.hidden'];
        for (const ns of unapproved) {
            assert.strictEqual(validateGalleryKey(`${ns}/test-file.jpg`), false,
                `Namespace "${ns}" should be rejected`);
        }
    });

    it('legacy root keys cannot access arbitrary files', () => {
        // validateLegacyRootKey only accepts UUID-format keys
        assert.strictEqual(validateLegacyRootKey('../etc/passwd'), false);
        assert.strictEqual(validateLegacyRootKey('admin-secret.key'), false);
        assert.strictEqual(validateLegacyRootKey('gallery/..'), false);
    });
});

describe('Edge cases', () => {
    it('handles URL-encoded keys correctly', () => {
        // If the key has special characters that got URL-encoded
        const url = '/api/gallery/media?key=profiles%2Fuser123%2Fphoto.jpg';
        const key = extractKey(url);
        // searchParams.get() automatically decodes %2F → /
        assert.strictEqual(key, 'profiles/user123/photo.jpg');
    });

    it('handles extra query parameters', () => {
        const url = '/api/gallery/media?key=profiles/uuid.jpg&format=original';
        const key = extractKey(url);
        assert.strictEqual(key, 'profiles/uuid.jpg');
    });

    it('handles leading slash in raw key', () => {
        const key = '/profiles/uuid-name.jpg';
        // extractKey: no '?' and doesn't start with 'http' → returns as-is
        const extracted = extractKey(key);
        assert.strictEqual(extracted, key);
        // validateKey accepts leading slash
        assert.strictEqual(validateKey(extracted), true);
    });

    it('handles key with hyphens and underscores', () => {
        assert.strictEqual(validateKey('profiles/my-user_123/photo-v2.jpg'), true);
        assert.strictEqual(validateKey('gallery/event-1/abc-def_file.webp'), true);
    });
});