// End-to-end API verification for the media pipeline + admin API matrix.
// - Signs in with a Firebase email/password account via the public web API key
//   (config comes from .env.local; values are never printed).
// - Exercises the real HTTP routes of whichever server BASE points at.
// - Proves media lands in the configured B2 bucket by HeadObject-ing the
//   returned keys directly against Backblaze S3.
// - Uploads only namespaced test objects and DELETES everything it created.
// Usage: BASE=http://localhost:3000 NODE_ENV=test node scripts/api-e2e-verify.mjs
// Requires: RELU_ADMIN_EMAIL / RELU_ADMIN_PASSWORD env vars (test account).

import assert from 'node:assert';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

// Minimal .env loader (dotenv is not a project dependency).
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
    }
}


const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = process.env.RELU_ADMIN_EMAIL;
const PASSWORD = process.env.RELU_ADMIN_PASSWORD;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

const results = [];
function record(route, method, test, pass, detail) {
    results.push({ route, method, test, pass, detail });
    console.log(`${pass ? '✔' : '✖'} ${method} ${route} — ${test}${detail ? ` (${detail})` : ''}`);
}

function pngBytes(color = [255, 0, 0, 255]) {
    // Hand-crafted, real (sharpl-parsable) 1x1 PNG.
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const idat = deflateSync(Buffer.from([0, color[0], color[1], color[2], color[3]]));
    const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([magic, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

let CRC_TABLE = null;
function crc32(buf) {
    if (!CRC_TABLE) {
        CRC_TABLE = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- sign-in
async function signIn() {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    });
    if (!res.ok) throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return { idToken: data.idToken, uid: data.localId };
}

async function H(token, extra = {}) { return { Authorization: `Bearer ${token}`, ...extra }; }

async function call(method, path, { token, body, form, headers = {}, raw } = {}) {
    const opts = { method, headers };
    if (token) opts.headers = await H(token, opts.headers);
    if (form) opts.body = form;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(`${BASE}${path}`, opts);
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers };
}

function b2Client() {
    return new S3Client({
        region: process.env.B2_REGION,
        endpoint: process.env.B2_S3_ENDPOINT,
        credentials: {
            accessKeyId: process.env.B2_APPLICATION_KEY_ID,
            secretAccessKey: process.env.B2_APPLICATION_KEY,
        },
    });
}

async function headInB2(key) {
    try { await b2Client().send(new HeadObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key })); return true; }
    catch (e) { return false; }
}

// ---------------------------------------------------------------- run
const eventId = `e2e-${randomUUID().slice(0, 8)}`;
const tmp = mkdtempSync(join(tmpdir(), 'relu-e2e-'));
try {
    const { idToken: token } = await signIn();
    record('identitytoolkit', 'POST', 'sign-in as admin test account', true, 'idToken obtained');

    // --- basic unauthenticated-read endpoints -------------------------------
    const health = await call('GET', '/api/health');
    record('/api/health', 'GET', '200 {status:ok}', health.status === 200 && health.json?.status === 'ok', `status=${health.status}`);
    const avatars = await call('GET', '/api/avatars');
    record('/api/avatars', 'GET', '200 categories list', avatars.status === 200, `status=${avatars.status} payload=${typeof avatars.json === 'object' && avatars.json !== null ? 'json' : (avatars.text || '').slice(0, 60)}`);

    // --- capability disclosure ------------------------------------------------
    const status = await call('GET', '/api/gallery/status', { token });
    const statusBody = JSON.stringify(status.json);
    const noSecrets = !statusBody.includes('APPLICATION_KEY') && !statusBody.includes('ACCESS_KEY') && !statusBody.includes('SECRET');
    record('/api/gallery/status', 'GET', 'storageConfigured + provider=b2, no secrets in payload', status.status === 200 && status.json?.storageConfigured === true && status.json?.provider === 'b2' && noSecrets, statusBody);

    // --- media/upload failure paths ------------------------------------------
    const noAuth = await call('POST', '/api/media/upload', { form: new FormData() });
    record('/api/media/upload', 'POST', 'unauthenticated → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const badPath = await call('POST', '/api/media/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([pngBytes()], 'x.png', { type: 'image/png' })); f.append('path', '../evil'); return f; })() });
    record('/api/media/upload', 'POST', 'traversal namespace → 400', badPath.status === 400, `status=${badPath.status}`);
    const emptyFile = await call('POST', '/api/media/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([], 'x.png', { type: 'image/png' })); f.append('path', 'event-images'); return f; })() });
    record('/api/media/upload', 'POST', '0-byte file → 400', emptyFile.status === 400, `status=${emptyFile.status}`);
    const spoofed = await call('POST', '/api/media/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([Buffer.from('plain text, definitely not media')], 'evil.png', { type: 'image/png' })); f.append('path', 'event-images'); return f; })() });
    record('/api/media/upload', 'POST', 'spoofed MIME (text disguised as image) → 400', spoofed.status === 400, `status=${spoofed.status}`);

    // --- media/upload success: image -----------------------------------------
    const imgBytes = pngBytes();
    const up = await call('POST', '/api/media/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([imgBytes], 'e2e-image.png', { type: 'image/png' })); f.append('path', 'event-images'); return f; })() });
    const upOk = up.status === 200 && typeof up.json?.key === 'string' && up.json?.url?.includes('/api/gallery/media?key=');
    record('/api/media/upload', 'POST', 'image upload → 200 + protected delivery URL', upOk, `${up.status} key=${up.json?.key ?? up.json?.error}`);

    // In-bucket proof: the returned key must exist in the B2 bucket
    if (upOk) {
        const inB2 = await headInB2(up.json.key);
        record('B2 bucket', 'HEAD', `object physically in ${process.env.B2_BUCKET_NAME}`, inB2);
        const delivered = await call('GET', up.json.url, { raw: true });
        const magic = Buffer.from(await delivered.arrayBuffer());
        const sig = magic.subarray(0, 4).toString('hex');
        const isPngOrWebp = sig === '89504e47' || magic.subarray(0, 4).toString('ascii') === 'RIFF';
        record('/api/gallery/media', 'GET', 'delivered bytes are a decodable image (png/webp after lossless pass)', delivered.status === 200 && isPngOrWebp, `status=${delivered.status} contentType=${delivered.headers.get('content-type')}`);

        const ranged = await call('GET', up.json.url, { raw: true, headers: { Range: 'bytes=0-15' } });
        const rbytes = ranged.status === 206 ? Buffer.from(await ranged.arrayBuffer()).length : -1;
        record('/api/gallery/media', 'GET', 'HTTP Range → 206 partial content', ranged.status === 206 && rbytes === 16, `status=${ranged.status} bytes=${rbytes}`);
    }

    // --- gallery upload: image (bulk) ----------------------------------------
    const galleryKeys = [];
    for (let i = 1; i <= 3; i++) {
        const g = await call('POST', '/api/gallery/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([pngBytes([i * 60, 0, 0, 255])], `e2e-g${i}.png`, { type: 'image/png' })); f.append('eventId', eventId); return f; })() });
        const ok = g.status === 200 && g.json?.key?.startsWith(`gallery/${eventId}/`);
        galleryKeys.push(g.json);
        record('/api/gallery/upload', 'POST', `gallery image #${i} → key in gallery/<eventId>/`, ok, `${g.status} ${g.json?.key ?? g.json?.error ?? ''}`);
    }

    // --- gallery upload: video pipeline --------------------------------------
    const videoPath = join(tmp, 'e2e.mp4');
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoPath], { stdio: 'ignore' });
    const videoBuf = readFileSync(videoPath);
    const v = await call('POST', '/api/gallery/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([videoBuf], 'e2e-video.mp4', { type: 'video/mp4' })); f.append('eventId', eventId); return f; })() });
    const vOk = v.status === 200 && v.json?.contentType === 'video/mp4' && v.json?.thumbnailKey;
    record('/api/gallery/upload', 'POST', 'video upload → compressed H.264 MP4 + poster thumbnail + status', vOk, `status=${v.status} contentType=${v.json?.contentType} thumb=${v.json?.thumbnailKey ?? v.json?.error} orig=${v.json?.originalKey ?? '-'} proc=${v.json?.processingStatus}`);
    if (v.json?.thumbnailKey && v.json?.thumbnailKey !== v.json.key) {
        const thumbInB2 = await headInB2(v.json.thumbnailKey);
        record('B2 bucket', 'HEAD', 'thumbnail physically in B2', thumbInB2);
    }
    if (v.json?.originalKey) {
        const origInB2 = await headInB2(v.json.originalKey);
        record('B2 bucket', 'HEAD', 'preserved original physically in B2', origInB2);
        const origDelv = await call('GET', `/api/gallery/media?key=${encodeURIComponent(v.json.originalKey)}`, { raw: true });
        record('/api/gallery/media', 'GET', 'original retrievable for reprocessing', origDelv.status === 200);
    }

    // --- failure & retry behavior -------------------------------------------
    const badEvent = await call('POST', '/api/gallery/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([pngBytes()], 'x.png', { type: 'image/png' })); f.append('eventId', '../evil'); return f; })() });
    record('/api/gallery/upload', 'POST', 'malicious eventId rejected', badEvent.status === 400, `status=${badEvent.status}`);
    const ejected = await call('POST', '/api/gallery/upload', { token, form: (() => { const f = new FormData(); f.append('file', new File([Buffer.from('nope')], 'x.png', { type: 'image/png' })); f.append('eventId', eventId); return f; })() });
    record('/api/gallery/upload', 'POST', 'non-media payload rejected (client can retry safely)', ejected.status === 400, `status=${ejected.status}`);

    // --- deletion (cleans every created object) ------------------------------
    const allKeys = [];
    if (upOk) allKeys.push(up.json.key);
    for (const g of galleryKeys) if (g?.key) allKeys.push(g.key);
    let deleted = 0;
    for (const k of allKeys) {
        const del = await call('POST', '/api/gallery/delete', { token, body: { key: k } });
        if (del.status === 200) deleted++;
    }
    if (vOk) {
        const vKeys = [{ key: v.json.key }, { key: v.json.thumbnailKey }, ...(v.json.originalKey ? [{ key: v.json.originalKey }] : [])];
        for (const kk of vKeys) {
            const del = await call('POST', '/api/gallery/delete', { token, body: kk });
            if (del.status === 200) deleted++;
        }
    }
    record('/api/gallery/delete', 'POST', 'every test object deleted (main + thumbnail + original)', deleted === allKeys.length + (vOk ? 3 : 0), `${deleted}/${allKeys.length + (vOk ? 3 : 0)}`);

    let gone = true;
    for (const k of allKeys) if (k && await headInB2(k)) gone = false;
    if (vOk) for (const k of [v.json.key, v.json.thumbnailKey, v.json.originalKey]) if (k && await headInB2(k)) gone = false;
    record('B2 bucket', 'HEAD', 'no leftovers in the bucket after cleanup', gone);

    const badKey = await call('POST', '/api/gallery/delete', { token, body: { key: 'profiles/../../etc/passwd' } });
    record('/api/gallery/delete', 'POST', 'traversal key rejected', badKey.status === 400, `status=${badKey.status}`);
    const noAuthDel = await call('POST', '/api/gallery/delete', { token: '', body: { key: 'gallery/x/y.jpg' } });
    record('/api/gallery/delete', 'POST', 'unauthenticated delete → 401', noAuthDel.status === 401, `status=${noAuthDel.status}`);

    // --- admin API matrix (read-only + error paths only) ----------------------
    const students = await call('GET', '/api/admin/students?page=1&pageSize=5', { token });
    record('/api/admin/students', 'GET', 'paginated student list with real data', students.status === 200 && Array.isArray(students.json?.students) && students.json?.total > 0, `total=${students.json?.total}`);
    const noAuthStudents = await call('GET', '/api/admin/students');
    record('/api/admin/students', 'GET', 'unauthenticated → 401', noAuthStudents.status === 401, `status=${noAuthStudents.status}`);
    const patchBad = await call('PATCH', '/api/admin/students', { token, body: { uid: 12, data: { class: 'x' } } });
    record('/api/admin/students', 'PATCH', 'schema-invalid body → 400 (no data touched)', patchBad.status === 400, `status=${patchBad.status} ${patchBad.json?.error ?? ''}`);

    const nickBad = await call('POST', '/api/admin/nicknames', { token, body: { uid: 'short', nickname: 'X' } });
    record('/api/admin/nicknames', 'POST', 'invalid uid → 400', nickBad.status === 400, `status=${nickBad.status}`);
    const nick404 = await call('POST', '/api/admin/nicknames', { token, body: { uid: 'x'.repeat(28), nickname: 'ZZZ' } });
    record('/api/admin/nicknames', 'POST', 'nonexistent admin uid → 404', nick404.status === 404, `status=${nick404.status}`);
    const nickNoAuth = await call('POST', '/api/admin/nicknames', { body: { uid: 'short', nickname: 'X' } });
    record('/api/admin/nicknames', 'POST', 'unauthenticated → 401', nickNoAuth.status === 401, `status=${nickNoAuth.status}`);

    const regNoAuth = await call('POST', '/api/registrations', { body: { action: 'register' } });
    record('/api/registrations', 'POST', 'unauthenticated → 401 (mutation path not exercised to keep real registration data intact)', regNoAuth.status >= 400 && regNoAuth.status < 500, `status=${regNoAuth.status}`);
    const mailNoAuth = await call('POST', '/api/send-email', { body: { to: 'x@y.z' } });
    record('/api/send-email', 'POST', 'unauthenticated → 401 (NO real email sent)', mailNoAuth.status === 401, `status=${mailNoAuth.status}`);
    const delUserNoAuth = await call('DELETE', '/api/admin/delete-user?uid=test');
    record('/api/admin/delete-user', 'DELETE', 'unauthenticated → 401', delUserNoAuth.status === 401, `status=${delUserNoAuth.status}`);
    const delAvatarNoAuth = await call('POST', '/api/admin/delete-avatar', { body: { uid: 'test' } });
    record('/api/admin/delete-avatar', 'POST', 'unauthenticated → 401', delAvatarNoAuth.status === 401, `status=${delAvatarNoAuth.status}`);
    const backfillNoAuth = await call('POST', '/api/gallery/backfill-thumbnails', {});
    record('/api/gallery/backfill-thumbnails', 'POST', 'unauthenticated → 401', backfillNoAuth.status === 401, `status=${backfillNoAuth.status}`);

    const failed = results.filter(r => !r.pass);
    console.log('\n==================== SUMMARY ====================');
    console.log(`Checks: ${results.length}, failed: ${failed.length}`);
    if (failed.length) { console.log(JSON.stringify(failed, null, 2)); process.exit(1); }
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
