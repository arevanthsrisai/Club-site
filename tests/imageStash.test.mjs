// Unit tests for the Image Stash shared helpers and storage-key boundary.
// Pure logic only: no Firebase or B2 credentials required.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import {
    friendlyImageUrl,
    isAssetId,
    sanitizeImageName,
    filenameFromUrl,
    extractStorageKey,
    galleryMediaUrl,
    assetReferenceCandidates,
    assetIdFromUrl,
    matchesImageSearch,
    createdWithin,
    formatBytes,
    MAX_IMAGE_UPLOAD_BYTES,
} from '../src/lib/imageStash.ts';
import { validateKey } from '../src/lib/storageValidation.ts';

describe('stable friendly URLs', () => {
    test('asset URLs are same-origin and id-based', () => {
        assert.strictEqual(friendlyImageUrl('abc12345'), '/api/images/abc12345');
    });

    test('asset ids reject traversal and short values', () => {
        assert.ok(isAssetId('550e8400-e29b-41d4-a716-446655440000'));
        assert.ok(isAssetId('abc12345'));
        assert.ok(!isAssetId('../etc/passwd'));
        assert.ok(!isAssetId('short'));
        assert.ok(!isAssetId('has/slash'));
        assert.ok(!isAssetId(''));
        assert.ok(!isAssetId(null));
    });

    test('assetIdFromUrl round-trips a friendly URL and ignores other values', () => {
        const id = '550e8400-e29b-41d4-a716-446655440000';
        assert.strictEqual(assetIdFromUrl(friendlyImageUrl(id)), id);
        assert.strictEqual(assetIdFromUrl(friendlyImageUrl(id) + '?v=2'), id);
        assert.strictEqual(assetIdFromUrl('/api/gallery/media?key=x'), null);
        assert.strictEqual(assetIdFromUrl('https://example.com/a.png'), null);
        assert.strictEqual(assetIdFromUrl(''), null);
    });
});

describe('filenames and keys', () => {
    test('sanitizeImageName strips extensions, separators and traversal', () => {
        assert.strictEqual(sanitizeImageName('My Photo.PNG'), 'My-Photo');
        assert.strictEqual(sanitizeImageName('../../etc/passwd'), 'etc-passwd');
        assert.strictEqual(sanitizeImageName('.hidden'), 'hidden');
        assert.strictEqual(sanitizeImageName(''), 'image');
        assert.strictEqual(sanitizeImageName(null), 'image');
        assert.ok(sanitizeImageName('x'.repeat(200)).length <= 60);
    });

    test('extractStorageKey handles gallery URLs and bare keys', () => {
        const key = 'image-stash/uuid-photo.webp';
        assert.strictEqual(extractStorageKey(galleryMediaUrl(key)), key);
        assert.strictEqual(extractStorageKey(`/api/gallery/media?key=${key}`), key);
        assert.strictEqual(extractStorageKey(key), key);
        assert.strictEqual(extractStorageKey('https://firebasestorage.googleapis.com/v0/b/x/o/y.png'), null);
        assert.strictEqual(extractStorageKey(''), null);
    });

    test('filenameFromUrl prefers the B2 key basename', () => {
        assert.strictEqual(
            filenameFromUrl('/api/gallery/media?key=gallery%2Fe%2Fuuid-photo.jpg'),
            'uuid-photo.jpg',
        );
        assert.strictEqual(filenameFromUrl('https://example.com/a/b/headshot.png'), 'headshot.png');
        assert.strictEqual(filenameFromUrl(''), 'image');
    });
});

describe('reference protection', () => {
    test('candidates cover every stored representation of an asset', () => {
        const candidates = assetReferenceCandidates({ id: 'abc12345', key: 'image-stash/u-p.webp' });
        assert.ok(candidates.includes('/api/images/abc12345'));
        assert.ok(candidates.includes('image-stash/u-p.webp'));
        assert.ok(candidates.includes(galleryMediaUrl('image-stash/u-p.webp')));
        assert.ok(candidates.includes('/api/gallery/media?key=image-stash/u-p.webp'));
    });

    test('an asset without a key only matches its friendly URL', () => {
        assert.deepStrictEqual(
            assetReferenceCandidates({ id: 'abc12345', key: null }),
            ['/api/images/abc12345'],
        );
    });
});

describe('stash browsing helpers', () => {
    const asset = {
        id: 'abc12345',
        url: '/api/images/abc12345',
        key: 'image-stash/u-photo.webp',
        filename: 'Graduation Photo.webp',
        sourceUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/old.png',
    };

    test('search matches filename, URL, key and source URL case-insensitively', () => {
        assert.ok(matchesImageSearch(asset, 'graduation'));
        assert.ok(matchesImageSearch(asset, 'abc12345'));
        assert.ok(matchesImageSearch(asset, 'image-stash'));
        assert.ok(matchesImageSearch(asset, 'firebasestorage'));
        assert.ok(matchesImageSearch(asset, '   '));
        assert.ok(!matchesImageSearch(asset, 'missing'));
    });

    test('date filter uses Firestore timestamps and Date values', () => {
        const now = Date.UTC(2026, 10, 24);
        assert.ok(createdWithin('all', null, now));
        assert.ok(createdWithin('7d', { seconds: Math.floor(now / 1000) - 2 * 86400 }, now));
        assert.ok(!createdWithin('7d', { seconds: Math.floor(now / 1000) - 10 * 86400 }, now));
        assert.ok(createdWithin('30d', new Date(now - 20 * 86400 * 1000), now));
        assert.ok(!createdWithin('30d', new Date(now - 40 * 86400 * 1000), now));
    });

    test('formatBytes is human readable and bounded', () => {
        assert.strictEqual(formatBytes(0), '—');
        assert.strictEqual(formatBytes(null), '—');
        assert.strictEqual(formatBytes(512), '512 B');
        assert.strictEqual(formatBytes(1536), '1.5 KB');
        assert.strictEqual(formatBytes(5 * 1024 * 1024), '5 MB');
    });

    test('the upload cap matches the rest of media storage (25 MB)', () => {
        assert.strictEqual(MAX_IMAGE_UPLOAD_BYTES, 25 * 1024 * 1024);
    });
});

describe('API route contracts (authorization cannot be stripped silently)', () => {
    const uploadRoute = readFileSync('./src/app/api/admin/images/route.ts', 'utf8');
    const deleteRoute = readFileSync('./src/app/api/admin/images/[id]/route.ts', 'utf8');
    const replaceRoute = readFileSync('./src/app/api/admin/images/[id]/replace/route.ts', 'utf8');
    const importRoute = readFileSync('./src/app/api/admin/images/import/route.ts', 'utf8');
    const deliveryRoute = readFileSync('./src/app/api/images/[id]/route.ts', 'utf8');

    test('every stash write route authenticates and authorizes server-side', () => {
        for (const source of [uploadRoute, deleteRoute, replaceRoute, importRoute]) {
            assert.ok(source.includes('getAdminContext'), 'must resolve the caller from a verified token');
            assert.ok(source.includes('unauthorized('), 'must reject unauthenticated callers');
            assert.ok(source.includes('forbidden('), 'must reject callers without permission');
        }
    });

    test('upload validates real image bytes and audited storage', () => {
        assert.ok(uploadRoute.includes('readImageUpload'), 'must sniff real content');
        assert.ok(uploadRoute.includes('image-stash'), 'must write to the approved namespace');
        assert.ok(uploadRoute.includes('validateKey'), 'must validate the generated key');
        assert.ok(uploadRoute.includes('logServerActivity'), 'must audit uploads');
    });

    test('delete refuses referenced assets before removing bytes', () => {
        const refCheck = deleteRoute.indexOf('findImageReferences');
        const byteDelete = deleteRoute.indexOf('deleteObjectPermanent');
        assert.ok(refCheck > -1, 'must check references');
        assert.ok(byteDelete > -1, 'must delete stored bytes');
        assert.ok(refCheck < byteDelete, 'references are checked before deletion');
    });

    test('delivery route validates the id and never trusts a stored URL blindly', () => {
        assert.ok(deliveryRoute.includes('isAssetId'), 'must validate asset ids');
        assert.ok(deliveryRoute.includes('validateKey'), 'must validate the stored B2 key');
        assert.ok(deliveryRoute.includes('https:'), 'external redirects must be protocol-checked');
    });
});

describe('image-stash namespace is enforced by storage validation', () => {
    test('validateKey accepts generated stash keys', () => {
        assert.ok(validateKey('image-stash/550e8400-e29b-41d4-a716-446655440000-photo.webp'));
        assert.ok(validateKey('/image-stash/550e8400-e29b-41d4-a716-446655440000-a.jpg'));
    });

    test('validateKey still rejects traversal and unknown namespaces', () => {
        assert.ok(!validateKey('image-stash/../secrets/key.png'));
        assert.ok(!validateKey('image-stash/'));
        assert.ok(!validateKey('other/550e8400-photo.png'));
        assert.ok(!validateKey('image-stash/a/b/../../x.png'));
    });
});
