// Unit tests for email normalization and gallery key validation.
// Pure-logic tests; no network or Firestore required.
import { test } from 'node:test';
import assert from 'node:assert';

// --- normalizeEmail (re-implemented inline to avoid bundling TS in the test runner) ---
function normalizeEmail(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    return trimmed.toLowerCase();
}

test('normalizeEmail trims and lowercases', () => {
    assert.strictEqual(normalizeEmail('  Admin@Example.COM  '), 'admin@example.com');
    assert.strictEqual(normalizeEmail('U4Xxx@AV.Students.Amrita.EDU'), 'u4xxx@av.students.amrita.edu');
});

test('normalizeEmail rejects empty / non-string', () => {
    assert.strictEqual(normalizeEmail(''), null);
    assert.strictEqual(normalizeEmail('   '), null);
    assert.strictEqual(normalizeEmail(undefined), null);
    assert.strictEqual(normalizeEmail(null), null);
});

// --- Gallery key validation (mirrors src/lib/objectStorage.ts) ---
function buildGalleryKey(eventId, filename, ext) {
    if (!/^[\w-]{1,64}$/.test(eventId)) return null;
    const safeName = filename.replace(/[^\w.-]+/g, '-').slice(0, 80).replace(/^[.-]+/, '') || 'file';
    return `gallery/${eventId}/${Math.random().toString(36).slice(2)}-${safeName}${ext}`;
}
function validateGalleryKey(key) {
    return /^gallery\/[\w-]{1,64}\/[\w.-]+$/.test(key);
}

test('buildGalleryKey rejects traversal in event id and sanitizes filenames', () => {
    assert.strictEqual(buildGalleryKey('../../etc', 'a.png', '.png'), null);
    // Filenames are sanitized (../etc/passwd -> etc-passwd), never used raw.
    const key = buildGalleryKey('e1', '../../../etc/passwd', '.png');
    assert.ok(key);
    assert.ok(!key.includes('..'), 'sanitized key must not contain path traversal');
    assert.ok(validateGalleryKey(key));
    assert.ok(buildGalleryKey('e1', 'photo', '.png'));
});

test('validateGalleryKey rejects out-of-namespace keys', () => {
    const key = buildGalleryKey('e1', 'photo', '.png');
    assert.ok(validateGalleryKey(key));
    assert.strictEqual(validateGalleryKey('etc/passwd'), false);
    assert.strictEqual(validateGalleryKey('gallery/e1/../../../etc'), false);
    assert.strictEqual(validateGalleryKey(''), false);
});

// --- Duplicate detection: normalized equality across mixed casing ---
test('case-insensitive email equality after normalization', () => {
    const a = 'Admin@Example.com';
    const b = 'admin@example.com';
    const c = 'ADMIN@EXAMPLE.COM';
    assert.strictEqual(normalizeEmail(a), normalizeEmail(b));
    assert.strictEqual(normalizeEmail(b), normalizeEmail(c));
});