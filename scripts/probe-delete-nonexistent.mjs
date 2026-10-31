// Probe: does S3 DeleteObject on a NEVER-EXISTED key create a hide-marker
// tombstone on B2 (which the web console shows as a 0-byte row)?
// Then FULLY removes any marker it created via b2_delete_file_version.
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); process.env[m[1]] = v; }
}
const client = new S3Client({
    region: process.env.B2_REGION, endpoint: process.env.B2_S3_ENDPOINT,
    credentials: { accessKeyId: process.env.B2_APPLICATION_KEY_ID, secretAccessKey: process.env.B2_APPLICATION_KEY },
});
const Bucket = process.env.B2_BUCKET_NAME;
const ghostKey = "profiles/zz-probe-ghost-delete-never-existed";

await client.send(new DeleteObjectCommand({ Bucket, Key: ghostKey }));
console.log("DeleteObject on never-existed key: done");

// check for a marker via native API
const basic = Buffer.from(process.env.B2_APPLICATION_KEY_ID + ':' + process.env.B2_APPLICATION_KEY).toString('base64');
const auth = await (await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: 'Basic ' + basic } })).json();
const r = await fetch(auth.apiUrl + '/b2api/v2/b2_list_file_versions', {
    method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: auth.allowed.bucketId, prefix: ghostKey, maxFileCount: 100 }),
});
const j = await r.json();
for (const f of j.files ?? []) {
    console.log(`MARKER/VERSION: ${f.action} ${f.contentLength}B ${new Date(f.uploadTimestamp).toISOString()} ${f.fileName} fileId=${f.fileId}`);
}
