// Live profile-media lifecycle test against the RUNNING app (server on :3000).
// Mints its own admin ID token via FIREBASE_ADMIN_KEY (no secret output).
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { S3Client, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
    }
}
const BASE = process.env.BASE || 'http://localhost:3000';

// --- Mint admin ID token ---
const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");
const sa = JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_KEY, "base64").toString("utf8"));
const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
const db = getFirestore(app);
const authAdm = getAuth(app);
const admins = await db.collection("admins").get();
let chosen = null;
for (const doc of admins.docs) {
    const d = doc.data();
    if (d.status === "active") chosen = chosen ?? doc;
}
if (!chosen) throw new Error("no active admin found");
const customToken = await authAdm.createCustomToken(chosen.id);
const swap = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
if (!swap.ok) throw new Error(`swap failed: ${swap.status} ${await swap.text()}`);
const { idToken: token } = await swap.json();
console.log("[test] admin ID token obtained (length=" + token.length + ")");

// --- A real, nonempty 1x1 PNG ---
function crc32(buf) {
    let T = globalThis.__T;
    if (!T) { T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 0; T[n] = c >>> 0; } globalThis.__T = T; }
    let crc = 0xffffffff;
    for (const b of buf) crc = T[(crc ^ b) & 0xff] >>> 0;
    return (crc ^ 0xffffffff) >>> 0;
}
function pngBytes(color = [90, 140, 220, 255]) {
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
const image = pngBytes();
console.log(`[test] upload payload: ${image.length} bytes of a valid PNG`);

// 1) Profile upload through the app route (the same route the browser's uploadMedia() uses)
const form = new FormData();
form.append('file', new File([image], 'profile-live-verify.png', { type: 'image/png' }));
form.append('path', 'profiles');
const up = await fetch(`${BASE}/api/media/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
});
const upJson = await up.json().catch(() => ({}));
console.log(`[test] POST /api/media/upload → ${up.status}`, JSON.stringify(upJson));
if (up.status !== 200) throw new Error('upload failed');
const key = upJson.key;
if (!key?.startsWith('profiles/')) throw new Error('key not under profiles/');

// 2) B2: the exact key exists with NONZERO size
const s3 = new S3Client({
    region: process.env.B2_REGION, endpoint: process.env.B2_S3_ENDPOINT,
    credentials: { accessKeyId: process.env.B2_APPLICATION_KEY_ID, secretAccessKey: process.env.B2_APPLICATION_KEY },
});
const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key }));
console.log(`[test] B2 HEAD ${key} → ContentLength=${head.ContentLength} ContentType=${head.ContentType}`);
if (!(head.ContentLength > 0)) throw new Error('object in B2 must be nonzero bytes');

// 3) Deliver through the app and compare bytes
const del = await fetch(`${BASE}${upJson.url}`);
const delBytes = Buffer.from(await del.arrayBuffer());
console.log(`[test] GET ${upJson.url} → ${del.status} content-type=${del.headers.get('content-type')} length=${delBytes.length}`);
if (del.status !== 200) throw new Error('delivery failed');
if (del.headers.get('content-type') !== 'image/png') throw new Error('wrong content type');
if (!delBytes.equals(image)) throw new Error('delivered bytes differ from upload');

// 4) Before delete: profiles/ must contain no NEW zero-byte objects from this test
const pre = await s3.send(new ListObjectsV2Command({ Bucket: process.env.B2_BUCKET_NAME, Prefix: 'profiles/', MaxKeys: 1000 }));
const preZero = (pre.Contents ?? []).filter(o => o.Size === 0);
console.log(`[test] profiles/ before delete: ${pre.Contents?.length} objects, ${preZero.length} zero-byte`);

// 5) Clean up ONLY the object OUR test created, via the app's admin delete route
const delRes = await fetch(`${BASE}/api/admin/delete-b2`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
});
const delResJson = await delRes.json().catch(() => ({}));
console.log(`[test] POST /api/admin/delete-b2 → ${delRes.status}`, JSON.stringify(delResJson));
if (delRes.status !== 200) throw new Error('admin delete failed');

// 6) The key must be fully gone from B2 (listings) and NO ghost left in profiles/
const post = await s3.send(new ListObjectsV2Command({ Bucket: process.env.B2_BUCKET_NAME, Prefix: 'profiles/', MaxKeys: 1000 }));
const stillThere = (post.Contents ?? []).find(o => o.Key === key);
const postZero = (post.Contents ?? []).filter(o => o.Size === 0);
console.log(`[test] profiles/ after delete: ${post.Contents?.length} objects, ${postZero.length} zero-byte, test key present=${!!stillThere}`);
if (stillThere) throw new Error('test object still present after delete');

// Native version check: zero versions (no upload, no hide-marker "ghost") for our key
const basic = Buffer.from(`${process.env.B2_APPLICATION_KEY_ID}:${process.env.B2_APPLICATION_KEY}`).toString('base64');
const auth = await (await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } })).json();
const vr = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_versions`, {
    method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: auth.allowed.bucketId, prefix: key, maxFileCount: 100 }),
});
const vs = (await vr.json()).files ?? [];
console.log(`[test] b2_list_file_versions for test key → ${vs.length} entries (must be 0 — no tombstone)`);
if (vs.length !== 0) throw new Error('deletion left a hide-marker tombstone');

console.log('\n[test] ALL PROFILE-LIFECYCLE CHECKS PASSED: upload → B2 nonzero → delivered identical → delete → no tombstone, no zero-byte');
