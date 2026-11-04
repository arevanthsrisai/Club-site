// Regression tests for storage provider selection in src/lib/objectStorage.ts:
// B2 is the only provider; nothing configured means no provider (the app must
// then FAIL CLOSED with an actionable error, never fall back to Firebase
// Storage, and unrecognized variables like *_R2 must be ignored).
import { test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// objectStorage.ts uses the app's "@/lib/..." TypeScript path alias; bridge it
// for the raw Node test runner before importing the module.
register('./alias-resolver.mjs', pathToFileURL(fileURLToPath(new URL('.', import.meta.url))));

const storage = await import('../src/lib/objectStorage.ts');

const ENV_KEYS = [...storage.STORAGE_ENV_KEYS.b2];

function withEnv(values, fn) {
    const saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
    try { fn(); } finally {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
}

test('B2 is selected when its variables are configured (legacy R2 vars are ignored)', () => {
    withEnv({
        B2_S3_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
        B2_REGION: 'eu-central-003',
        B2_BUCKET_NAME: 'reluwebsite',
        B2_APPLICATION_KEY_ID: 'keyid',
        B2_APPLICATION_KEY: 'secret',
        // Stale legacy R2 variables left behind in an env file must not
        // resurrect any R2 code path: unknown keys are simply ignored.
        R2_ACCOUNT_ID: 'acct',
        R2_ACCESS_KEY_ID: 'r2id',
        R2_SECRET_ACCESS_KEY: 'r2secret',
        R2_BUCKET_NAME: 'r2bucket',
        R2_PUBLIC_BASE_URL: 'https://cdn.example.com',
    }, () => {
        const config = storage.getStorageConfig();
        assert.strictEqual(config.provider, 'b2');
        assert.strictEqual(config.bucketName, 'reluwebsite');
    });
});

test('no provider is selected when nothing is configured (fail closed)', () => {
    withEnv({}, () => {
        assert.strictEqual(storage.getStorageConfig(), null);
    });
});

test('a partial B2 configuration disables uploads (fail closed)', () => {
    withEnv({
        B2_S3_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
        B2_REGION: 'eu-central-003',
        // bucket missing → incomplete B2
        B2_APPLICATION_KEY_ID: 'keyid',
        B2_APPLICATION_KEY: 'secret',
    }, () => {
        assert.strictEqual(storage.getStorageConfig(), null, 'missing a required B2 var must disable uploads');
    });
});

test('non-https endpoints are rejected', () => {
    withEnv({
        B2_S3_ENDPOINT: 'http://insecure.example.com',
        B2_REGION: 'eu-central-003',
        B2_BUCKET_NAME: 'reluwebsite',
        B2_APPLICATION_KEY_ID: 'keyid',
        B2_APPLICATION_KEY: 'secret',
    }, () => {
        assert.strictEqual(storage.getStorageConfig(), null);
    });
});

test('sniffMedia ignores spoofed browser MIME types and validates real content', () => {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const mp4 = Buffer.from('....ftypisom??????', 'ascii');
    const junk = Buffer.from('not-media-at-all');
    assert.strictEqual(storage.sniffMedia(jpeg, 'application/pdf').type, 'image');
    assert.strictEqual(storage.sniffMedia(png, 'video/mp4').type, 'image');
    assert.strictEqual(storage.sniffMedia(mp4, 'image/png').type, 'video');
    assert.strictEqual(storage.sniffMedia(junk, 'image/png'), null);
});

test('buildGalleryKey rejects traversal and produces namespace-unique keys', () => {
    assert.strictEqual(storage.buildGalleryKey('../evil', 'doc', '.jpg'), null);
    assert.strictEqual(storage.buildGalleryKey('event; DROP', 'doc', '.jpg'), null);
    const key = storage.buildGalleryKey('abc123', 'My Photo!', '.jpg');
    assert.ok(key.startsWith('gallery/abc123/'), key);
    assert.ok(/[\w.-]+$/.test(key));
    assert.ok(storage.validateKey(key));
    // The app-approved namespaces all pass generic key validation…
    assert.ok(storage.validateKey('profiles/uid-1/photo.jpg'));
    // …but gallery delivery is guarded by validateGalleryKey, which must
    // reject a gallery filename smuggled into another namespace.
    assert.ok(storage.validateGalleryKey(key));
    assert.ok(!storage.validateGalleryKey('profiles/X/' + key.split('/').pop()));
});
