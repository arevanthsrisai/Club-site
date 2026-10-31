// Clean up the 4-byte e2e-video leftovers created by the OLD (pre-fix)
// sniffMedia bug (empty/short payloads accepted as video/mp4), identified by
// their "-x.mp4" key suffix and the e2e test namespaces. Version-level
// deletion only — leaves no tombstone because no plain DeleteObject is used.
import { readFileSync } from "node:fs";
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); process.env[m[1]] = v; }
}
const basic = Buffer.from(process.env.B2_APPLICATION_KEY_ID + ':' + process.env.B2_APPLICATION_KEY).toString('base64');
const auth = await (await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } })).json();

// Collect all upload-version entries whose fileName ends in "-x.mp4" (the
// non-media-payload bug artifact) plus any hide marker versions for them.
const targets = [];
let nextFileName, nextFileId;
do {
    const r = await fetch(auth.apiUrl + '/b2api/v2/b2_list_file_versions', {
        method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: auth.allowed.bucketId, maxFileCount: 1000, ...(nextFileName ? { startFileName: nextFileName, startFileId: nextFileId } : {}) }),
    });
    const j = await r.json();
    for (const f of j.files ?? []) {
        if (f.fileName.endsWith("-x.mp4") || f.fileName.endsWith("x.mp4")) targets.push(f);
    }
    nextFileName = j.nextFileName;
    nextFileId = j.nextFileId;
} while (nextFileName);

console.log("found", targets.length, "x.mp4 leftover entries to purge");
const seen = new Set();
for (const t of targets) {
    if (seen.has(t.fileId)) continue;
    seen.add(t.fileId);
    const d = await fetch(auth.apiUrl + '/b2api/v2/b2_delete_file_version', {
        method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: t.fileId, fileName: t.fileName }),
    });
    console.log(d.ok ? `purged ${t.action} ${t.fileName}` : `FAILED ${t.fileId}: ${d.status}`);
}
console.log("done");
