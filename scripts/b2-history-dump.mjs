import { readFileSync } from "node:fs";
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); process.env[m[1]] = v; }
}
const basic = Buffer.from(process.env.B2_APPLICATION_KEY_ID + ':' + process.env.B2_APPLICATION_KEY).toString('base64');
const auth = await (await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: 'Basic ' + basic } })).json();

const all = [];
let startFileName = undefined, startFileId = undefined;
do {
    const r = await fetch(auth.apiUrl + '/b2api/v2/b2_list_file_versions', {
        method: 'POST',
        headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: auth.allowed.bucketId, maxFileCount: 1000, ...(startFileName ? { startFileName, startFileId } : {}) }),
    });
    if (!r.ok) { console.log('failed:', r.status, await r.text()); break; }
    const j = await r.json();
    all.push(...(j.files ?? []));
    startFileName = j.nextFileName;
    startFileId = j.nextFileId;
} while (startFileName);

console.log('TOTAL VERSIONS:', all.length);
const byAction = {};
for (const f of all) byAction[f.action] = (byAction[f.action] ?? 0) + 1;
console.log('by action:', byAction);

console.log('\n--- enteries containing 2891c3cd or e439deb5 or 67.5KB-pattern or hackopoly ---');
for (const f of all) {
    if (/2891c3cd|e439deb5|hackopoly/.test(f.fileName)) {
        console.log(`${f.action.padEnd(7)} ${String(f.contentLength).padStart(7)} B  ${new Date(f.uploadTimestamp).toISOString()}  ${f.fileName}  fileId=${f.fileId}`);
    }
}

console.log('\n--- ALL profiles/* versions ---');
let found = 0;
for (const f of all) {
    if (f.fileName.startsWith('profiles/')) {
        found++;
        console.log(`${f.action.padEnd(7)} ${String(f.contentLength).padStart(7)} B  ${new Date(f.uploadTimestamp).toISOString()}  ${f.fileName}`);
    }
}
console.log('profiles count:', found);

console.log('\n--- every non-upload action (hide/folder/other) ---');
const non = all.filter(f => f.action !== 'upload');
console.log('non-upload entries:', non.length);
for (const f of non.slice(0, 40)) {
    console.log(`${f.action.padEnd(7)} ${String(f.contentLength).padStart(7)} B  ${new Date(f.uploadTimestamp).toISOString()}  ${f.fileName}`);
}
