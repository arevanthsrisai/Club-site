/**
 * Regression tests for sniffMedia's boundary conditions.
 *
 * Root cause being guarded against (verified against the live B2 bucket
 * on 2026-10-31): the pre-fix implementation used
 *   `s.startsWith(String.fromCharCode(...buf.slice(i, i + s.length)))` —
 * an empty or short buffer produced String.fromCharCode() === "" so
 * `"ftyp".startsWith("")` was TRUE and arbitrary payloads with fewer than
 * 8 bytes (including a zero-byte upload) were accepted as video/mp4 and
 * written to B2 (evidenced by leftover 4-byte `.mp4` objects from earlier
 * e2e runs).
 *
 * The fix enforces `buf.length >= i + s.length` and an exact prefix match.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./alias-resolver.mjs', pathToFileURL(fileURLToPath(new URL('.', import.meta.url))));

const storage = await import('../src/lib/objectStorage.ts');
const { sniffMedia } = storage;

test('sniffMedia rejects a zero-byte buffer (never sniffs as video/mp4 or pdf)', () => {
    assert.strictEqual(sniffMedia(Buffer.alloc(0), 'video/mp4'), null);
    assert.strictEqual(sniffMedia(Buffer.alloc(0), 'image/png'), null);
    assert.strictEqual(sniffMedia(Buffer.alloc(0), ''), null);
});

test('sniffMedia rejects short non-media payloads that the old empty-slice bug accepted', () => {
    // 'nope' is exactly the payload earlier e2e runs observed being accepted
    // as video/mp4 and uploaded as a 4-byte object with an .mp4 key.
    assert.strictEqual(sniffMedia(Buffer.from('nope', 'ascii'), ''), null);
    assert.strictEqual(sniffMedia(Buffer.from('<a>', 'ascii'), 'image/png'), null);
    assert.strictEqual(sniffMedia(Buffer.from('<?php'), 'image/jpeg'), null);
});

test('sniffMedia rejects truncated magic strings regardless of trailing bytes', () => {
    // 7 of 8 PNG bytes must not pass the PNG check
    assert.strictEqual(sniffMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]), 'image/png'), null);
    // 'ftyp' must sit at offset 4 with at least 8 bytes total; a 7-byte buffer
    // where the first four bytes need padding cannot qualify.
    assert.strictEqual(sniffMedia(Buffer.from('xxftyp'.slice(0, 6) + 'y'.repeat(1)), ''), null);
    // ftyp exactly at 4 with only 4 bytes after it is the minimum video header
    assert.strictEqual(sniffMedia(Buffer.from('....ftypisom', 'ascii'), 'image/png')?.type, 'video');
});

test('sniffMedia keeps accepting real media of every supported format', () => {
    assert.strictEqual(sniffMedia(Buffer.from([0xFF, 0xD8, 0xFF, 0x00]), 'application/pdf')?.contentType, 'image/jpeg');
    assert.strictEqual(sniffMedia(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), '')?.contentType, 'image/png');
    assert.strictEqual(sniffMedia(Buffer.from('GIF8'), '')?.contentType, 'image/gif');
    const webp = Buffer.from('RIFF????WEBPVP8 ????????', 'ascii');
    assert.strictEqual(sniffMedia(webp, '')?.contentType, 'image/webp');
    assert.strictEqual(sniffMedia(Buffer.from('....ftypavif0000', 'ascii'), '')?.contentType, 'video/mp4');
    assert.strictEqual(sniffMedia(Buffer.from([0x25, 0x50, 0x44, 0x46]), '')?.contentType, 'application/pdf');
});

test('sniffMedia accepts non-ASCII-named media files only by content, not by their name/type', () => {
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.strictEqual(sniffMedia(png, 'text/html')?.type, 'image');
});
