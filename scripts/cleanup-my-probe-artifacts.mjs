// Permanently removes ONLY this session's probe artifacts (version-level
// deletes via b2_delete_file_version) after verifying their presence.
import { readFileSync } from "node:fs";
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); process.env[m[1]] = v; }
}
const basic = Buffer.from(process.env.B2_APPLICATION_KEY_ID + ':' + process.env.B2_APPLICATION_KEY).toString('base64');
const auth = await (await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: 'Basic ' + basic } })).json();

const MY_PREFIXES = ["profiles/zz-probe-"];
const targetNames = [];
for (const prefix of MY_PREFIXES) {
    const r = await fetch(auth.apiUrl + '/b2api/v2/b2_list_file_versions', {
        method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: auth.allowed.bucketId, prefix, maxFileCount: 100 }),
    });
    const j = await r.json();
    for (const f of j.files ?? []) targetNames.push({ fileId: f.fileId, fileName: f.fileName, action: f.action });
}

console.log('probe artifacts found:', targetNames.length);
for (const t of targetNames) console.log('  ', t.action, t.fileName);

for (const t of targetNames) {
    const d = await fetch(auth.apiUrl + '/b2api/v2/b2_delete_file_version', {
        method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: t.fileId, fileName: t.fileName }),
    });
    if (d.ok) console.log('deleted version:', t.fileName, '(' + t.action + ') — gone from bucket permanently');
    else console.log('FAILED', t.fileName, d.status, await d.text());
}
console.log('done');
