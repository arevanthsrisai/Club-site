// Unit tests for B2 storage key validation functions.
// Pure-logic tests; no network or storage credentials required.
import { test } from 'node:test';
import assert from 'node:assert';

// --- Validation functions (mirrors src/lib/objectStorage.ts) ---

/**
 * Validates that a key belongs to one of the application's approved purpose-specific prefixes.
 * Canonical format: {namespace}/{[ownerId]/}{uuid}-{safeName}.{ext}
 * Deliberately does NOT accept bare root-level keys.
 */
function validateGalleryKey(key) {
    return /^\/?(gallery|avatars|profiles|team_profiles|resources|event-images|event-covers|resource-thumbnails)\/([\w-]{1,64}\/)?[\w.-]+$/.test(key);
}

/**
 * Validates a legacy root-level key: `uuid-{name}.{ext}` with no slashes.
 * Only hex UUIDs (8-4-4-4-12) followed by a dash and safe characters are accepted.
 */
function validateLegacyRootKey(key) {
    return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}-[\w.-]+$/.test(key);
}

/**
 * General namespace validator (namespaced keys only).
 * Currently aliases validateGalleryKey.
 */
function validateKey(key) {
    return validateGalleryKey(key);
}

// --- Tests for validateGalleryKey (namespaced keys) ---

test('validateGalleryKey accepts valid namespaced keys', () => {
    assert.ok(validateGalleryKey('gallery/event123/abc123-photo.png'));
    assert.ok(validateGalleryKey('gallery/abc-def/uuid-here-image.jpg'));
    assert.ok(validateGalleryKey('avatars/user1/uuid-avatar.png'));
    assert.ok(validateGalleryKey('profiles/member/uuid-photo.webp'));
    assert.ok(validateGalleryKey('team_profiles/lead/uuid-headshot.jpg'));
    assert.ok(validateGalleryKey('resources/doc/uuid-file.pdf'));
    assert.ok(validateGalleryKey('event-images/event/uuid-cover.mp4'));
    assert.ok(validateGalleryKey('event-covers/event/uuid-cover.jpg'));
    assert.ok(validateGalleryKey('resource-thumbnails/doc/uuid-thumb.png'));
});

test('validateGalleryKey accepts keys with optional leading slash', () => {
    assert.ok(validateGalleryKey('/gallery/event123/abc123-photo.png'));
    assert.ok(validateGalleryKey('/avatars/user1/uuid-avatar.png'));
});

test('validateGalleryKey rejects root-level keys (no namespace)', () => {
    assert.strictEqual(validateGalleryKey('abc123-photo.png'), false);
    assert.strictEqual(validateGalleryKey('06bebf1e-1234-5678-9abc-def012345678-moon-at-night.mp4'), false);
    assert.strictEqual(validateGalleryKey('uuid-photo.png'), false);
});

test('validateGalleryKey rejects path traversal attempts', () => {
    assert.strictEqual(validateGalleryKey('gallery/../../../etc/passwd'), false);
    assert.strictEqual(validateGalleryKey('gallery/foo/../../bar'), false);
    assert.strictEqual(validateGalleryKey('../etc/passwd'), false);
    assert.strictEqual(validateGalleryKey('gallery//double-slash'), false);
});

test('validateGalleryKey rejects invalid namespaces', () => {
    assert.strictEqual(validateGalleryKey('unknown/photo.png'), false);
    assert.strictEqual(validateGalleryKey('etc/passwd'), false);
    assert.strictEqual(validateGalleryKey('random/key.jpg'), false);
});

test('validateGalleryKey rejects malformed keys', () => {
    assert.strictEqual(validateGalleryKey(''), false);
    assert.strictEqual(validateGalleryKey('gallery/'), false);
    assert.strictEqual(validateGalleryKey('/gallery/'), false);
    assert.strictEqual(validateGalleryKey('gallery'), false);
    assert.strictEqual(validateGalleryKey(null), false);
    assert.strictEqual(validateGalleryKey(undefined), false);
});

// --- Tests for validateLegacyRootKey (UUID-based root-level keys) ---

test('validateLegacyRootKey accepts valid legacy UUID keys', () => {
    assert.ok(validateLegacyRootKey('06bebf1e-1234-5678-9abc-def012345678-moon-at-night.mp4'));
    assert.ok(validateLegacyRootKey('08b10d8f-abcd-ef12-3456-789012345678-SIH2026-presentation.pptx.webp'));
    assert.ok(validateLegacyRootKey('4173a858-9876-5432-10ab-cdef01234567-harry_1.mp4'));
    assert.ok(validateLegacyRootKey('a1b2c3d4-e5f6-7890-abcd-ef1234567890-photo.jpg'));
    assert.ok(validateLegacyRootKey('deadbeef-cafe-babe-face-123456789abc-image.png'));
});

test('validateLegacyRootKey accepts keys with underscores and dots in name', () => {
    assert.ok(validateLegacyRootKey('12345678-1234-1234-1234-123456789abc-file_name.jpg'));
    assert.ok(validateLegacyRootKey('12345678-1234-1234-1234-123456789abc-photo.2024.png'));
    assert.ok(validateLegacyRootKey('12345678-1234-1234-1234-123456789abc-test_file.name.ext'));
});

test('validateLegacyRootKey rejects non-UUID root-level keys', () => {
    assert.strictEqual(validateLegacyRootKey('photo.png'), false);
    assert.strictEqual(validateLegacyRootKey('uuid-photo.png'), false);
    assert.strictEqual(validateLegacyRootKey('gallery/photo.png'), false);
    assert.strictEqual(validateLegacyRootKey('random-key.jpg'), false);
});

test('validateLegacyRootKey rejects malformed UUIDs', () => {
    // Wrong segment lengths
    assert.strictEqual(validateLegacyRootKey('1234567-1234-5678-9abc-def012345678-photo.png'), false); // 7 chars
    assert.strictEqual(validateLegacyRootKey('123456789-1234-5678-9abc-def012345678-photo.png'), false); // 9 chars
    assert.strictEqual(validateLegacyRootKey('12345678-123-5678-9abc-def012345678-photo.png'), false); // 3 chars
    assert.strictEqual(validateLegacyRootKey('12345678-12345-5678-9abc-def012345678-photo.png'), false); // 5 chars
    
    // Non-hex characters in UUID
    assert.strictEqual(validateLegacyRootKey('ghijklmn-1234-5678-9abc-def012345678-photo.png'), false);
    assert.strictEqual(validateLegacyRootKey('12345678-ghij-5678-9abc-def012345678-photo.png'), false);
    
    // Missing segments
    assert.strictEqual(validateLegacyRootKey('12345678-1234-5678-9abc-photo.png'), false); // 4 segments
    assert.strictEqual(validateLegacyRootKey('12345678-1234-5678-def012345678-photo.png'), false); // 3 segments
    
    // No dash before filename
    assert.strictEqual(validateLegacyRootKey('12345678-1234-5678-9abc-def012345678photo.png'), false);
});

test('validateLegacyRootKey rejects keys with slashes (namespaced)', () => {
    assert.strictEqual(validateLegacyRootKey('gallery/uuid-photo.png'), false);
    assert.strictEqual(validateLegacyRootKey('profiles/uuid-photo.png'), false);
    assert.strictEqual(validateLegacyRootKey('uuid/photo.png'), false);
});

test('validateLegacyRootKey rejects empty and null inputs', () => {
    assert.strictEqual(validateLegacyRootKey(''), false);
    assert.strictEqual(validateLegacyRootKey(null), false);
    assert.strictEqual(validateLegacyRootKey(undefined), false);
});

// --- Tests for validateKey (general namespace validator) ---

test('validateKey aliases validateGalleryKey for namespaced keys', () => {
    assert.ok(validateKey('gallery/event123/photo.png'));
    assert.ok(validateKey('avatars/user1/avatar.jpg'));
    assert.strictEqual(validateKey('gallery/'), false);
    assert.strictEqual(validateKey(''), false);
});

test('validateKey rejects legacy root-level keys (security boundary)', () => {
    // This is intentional: the general-purpose deletion/delivery path
    // must NOT accept bare root-level keys. Only the cleanup script
    // uses validateLegacyRootKey() for migration purposes.
    assert.strictEqual(validateKey('06bebf1e-1234-5678-9abc-def012345678-photo.mp4'), false);
    assert.strictEqual(validateKey('uuid-photo.png'), false);
    assert.strictEqual(validateKey('random-key.jpg'), false);
});

// --- Security boundary tests ---

test('validateGalleryKey and validateKey maintain security boundary', () => {
    // Namespaced keys should pass gallery validation
    assert.ok(validateGalleryKey('gallery/event/photo.png'));
    assert.ok(validateKey('gallery/event/photo.png'));
    
    // Root-level keys should FAIL gallery validation (security boundary)
    assert.strictEqual(validateGalleryKey('06bebf1e-1234-5678-9abc-def012345678-photo.mp4'), false);
    assert.strictEqual(validateKey('06bebf1e-1234-5678-9abc-def012345678-photo.mp4'), false);
    
    // Root-level keys should PASS legacy validation (for cleanup only)
    assert.ok(validateLegacyRootKey('06bebf1e-1234-5678-9abc-def012345678-photo.mp4'));
});

test('Path traversal is rejected by all validators', () => {
    const traversalKeys = [
        '../../../etc/passwd',
        'gallery/../../../etc/passwd',
        'gallery/foo/../../bar',
        '/gallery/../../etc/passwd',
        '....//....//etc/passwd',
    ];
    
    for (const key of traversalKeys) {
        assert.strictEqual(validateGalleryKey(key), false, `validateGalleryKey should reject: ${key}`);
        assert.strictEqual(validateKey(key), false, `validateKey should reject: ${key}`);
        assert.strictEqual(validateLegacyRootKey(key), false, `validateLegacyRootKey should reject: ${key}`);
    }
});
