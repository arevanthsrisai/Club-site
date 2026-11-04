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
 *
 * Since the legacy R2 provider was removed, B2 is the only provider and that
 * final plain delete is simply never issued: the guard these comments
 * describe is now "no version-id-less DeleteObject exists at all".
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

test('deleteObjectPermanent never fires a plain version-id-less DeleteObject (no B2 tombstones)', () => {
    // A version-id-less DeleteObject on B2 leaves a "hide marker" tombstone
    // (0-byte row in the B2 web console) even when the object was already
    // gone — so the permanent-delete path must not contain one at all.
    assert.doesNotMatch(
        deletePermanentSource(),
        /DeleteObjectCommand\(\{[^}]*Key: key[,} ][^}]*\}\)/,
        'a version-id-less DeleteObject snuck back into deleteObjectPermanent',
    );
});

test('deleteObjectPermanent still deletes every discovered version by VersionId (bytes are removed)', () => {
    assert.match(deletePermanentSource(), /VersionId: item\.VersionId/);
});
