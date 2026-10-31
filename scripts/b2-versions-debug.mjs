import { readFileSync } from "node:fs";
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); process.env[m[1]] = v; }
}
const basic = Buffer.from(process.env.B2_APPLICATION_KEY_ID + ':' + process.env.B2_APPLICATION_KEY).toString('base64');
const auth = await (await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: 'Basic ' + basic } })).json();

const r = await fetch(auth.apiUrl + '/b2api/v2/b2_list_file_versions', {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: auth.allowed.bucketId, maxFileCount: 100 }),
});
console.log('status:', r.status);
console.log((await r.text()).slice(0, 3000));

// Also fetch bucket details (versioning/fileLock state)
const b = await (await fetch(auth.apiUrl + '/b2api/v2/b2_get_bucket', {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: auth.allowed.bucketId }),
})).json();
console.log('\nbucket state:', JSON.stringify({
    bucketName: b.bucketName, type: b.type, fileLockEnabled: b.fileLockEnabled,
    revision: b.revision, lifecycleRules: b.lifecycleRules ?? null,
}, null, 2));
