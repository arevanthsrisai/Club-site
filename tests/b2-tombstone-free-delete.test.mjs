/**
 * LIVE integration proof that app-level permanent deletion leaves NO tombstones.
 *
 * The pre-fix `deleteObjectPermanent` always fired a plain, version-id-less
 * S3 DeleteObject after the version loop. On Backblaze B2 that call creates
 * a permanent hide marker — a row the B2 web console renders as a "0 bytes"
 * ghost file, invisible to every object listing. An earlier session of this
 * test (against the REAL bucket, 2026-10-31) reproduced exactly that:
 *
 *   upload  profiles/zz-probe-ghost-delete-never-existed → DeleteObject →
 *   b2_list_file_versions ⇒ { action: "hide", contentLength: 0 }
 *
 * With the fixed implementation the same flows must leave ZERO versions:
 *   1. deleteObjectPermanent on a freshly uploaded object  → no versions at all
 *   2. deleteObjectPermanent on a never-existing key       → no versions at all
 *
 * Runs only when B2 credentials are present (skips otherwise). Creates and
 * removes ONLY its own uniquely-named probe objects, fully (version-level).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

register('./alias-resolver.mjs', pathToFileURL(fileURLToPath(new URL('.', import.meta.url))));

// .env.local loader (dotenv is not a project dependency).
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); process.env[m[1]] = v; }
}

const HAS_B2 = !!process.env.B2_APPLICATION_KEY;
const storage = await import('../src/lib/objectStorage.ts');

function api() {
    const basic = Buffer.from(`${process.env.B2_APPLICATION_KEY_ID}:${process.env.B2_APPLICATION_KEY}`).toString('base64');
    return fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } }).then(r => r.json());
}

async function versionsFor(auth, fileName) {
    const r = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_versions`, {
        method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: auth.allowed.bucketId, prefix: fileName, maxFileCount: 100 }),
    });
    const j = await r.json();
    return (j.files ?? []).filter(v => v.fileName === fileName);
}

/** Nuclear cleanup for OUR probe key only: version-level deletes of every entry. */
async function purgeProbeVersions(auth, fileName) {
    for (const v of await versionsFor(auth, fileName)) {
        await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
            method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: v.fileId, fileName }),
        });
    }
}

const key1 = `profiles/zz-tombstone-live-${randomUUID()}.txt`;
const key2 = `profiles/zz-tombstone-live-never-existed-${randomUUID()}.txt`;
let auth, client, config;

test.before(async () => (globalThis.__tombstoneSetup = null));

(HAS_B2 ? test : test.skip)('deleting an existing object leaves no upload version and no hide marker', { timeout: 120000 }, async () => {
    if (!HAS_B2) return;
    config = storage.getStorageConfig();
    assert.ok(config, 'B2 must be configured');
    auth = await api();
    client = new S3Client({
        region: config.region, endpoint: config.endpoint,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });

    await client.send(new PutObjectCommand({ Bucket: config.bucketName, Key: key1, Body: Buffer.from('tombstone regression probe'), ContentType: 'text/plain' }));
    assert.ok((await versionsFor(auth, key1)).length === 1, 'probe object exists before deletion');

    await storage.deleteObjectPermanent(config, key1);

    const versions = await versionsFor(auth, key1);
    assert.strictEqual(versions.length, 0, `expected no versions after permanent delete, got: ${JSON.stringify(versions.map(v => v.action))}`);
});

(HAS_B2 ? test : test.skip)('deleting a key that never existed creates no hide marker (tombstone)', { timeout: 120000 }, async () => {
    if (!HAS_B2) return;
    await storage.deleteObjectPermanent(config, key2);
    const versions = await versionsFor(auth, key2);
    assert.strictEqual(versions.length, 0, `expected no tombstone for never-existing key, got: ${JSON.stringify(versions.map(v => v.action))}`);
});

after(async () => {
    if (auth && HAS_B2) {
        await purgeProbeVersions(auth, key1);
        await purgeProbeVersions(auth, key2);
    }
});
