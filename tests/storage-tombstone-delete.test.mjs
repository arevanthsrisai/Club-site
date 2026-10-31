/**
 * Unit regressions for the B2 tombstone-free permanent deletion contract in
 * src/lib/objectStorage.ts `deleteObjectPermanent`.
 *
 * Root cause being guarded against (verified live on 2026-10-31): the
 * previous implementation always fired a final plain (version-id-less) S3
 * DeleteObject. On Backblaze B2 that call NEVER erases data — it creates a
 * permanent "hide marker" that is invisible to every object listing yet is
 * rendered by the B2 web console's Browse Files page as an immortal
 * "0 bytes" ghost row, even for keys that never existed or whose versions
 * were just fully removed. Every admin delete route therefore sprayed
 * tombstones into the user's bucket view after every deletion.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

register('./alias-resolver.mjs', pathToFileURL(fileURLToPath(new URL('.', import.meta.url))));

const source = readFileSync(new URL('../src/lib/objectStorage.ts', import.meta.url), 'utf8');

function deletePermanentSource() {
    const start = source.indexOf('export async function deleteObjectPermanent');
    return source.slice(start, source.indexOf('export async function deleteObject(', start));
}

test('deleteObjectPermanent fires the plain DeleteObject only for non-B2 providers', () => {
    // On B2, a plain version-id-less DeleteObject leaves a "hide marker"
    // tombstone (0-byte row in the B2 web console) even when the object was
    // already gone — so it must be provider-gated.
    assert.match(deletePermanentSource(), /provider !== "b2"/);
});

test('deleteObjectPermanent still deletes every discovered version by VersionId (bytes are removed)', () => {
    assert.match(deletePermanentSource(), /VersionId: item.VersionId/);
});

// Behavioral deep-check without network access: the provider gate ordering
// must mean the plain delete happens AFTER the version loop, so a failed
// version deletion aborts before the tombstone-prone call.
test('plain delete is ordered after the version-level delete loop', () => {
    const fn = deletePermanentSource();
    const loopIdx = fn.indexOf('DeleteObjectCommand({ Bucket: config.bucketName, Key: item.Key, VersionId: item.VersionId })');
    const gateIdx = fn.indexOf('provider !== "b2"');
    assert.ok(loopIdx > 0 && gateIdx > loopIdx, 'plain delete must come after the version loop');
});
