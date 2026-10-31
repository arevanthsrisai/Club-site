// B2 behavior probe (self-cleaning, read-mostly):
// 1) Is a true 0-byte PutObject visible in listings? (create, verify, delete)
// 2) Is an unfinished multipart/large-file session visible in listings
//    but showable as "0 bytes" in the web console? (create, verify, abort)
// Cleans up everything it creates. Never touches pre-existing objects.
import { S3Client, ListObjectsV2Command, PutObjectCommand, CreateMultipartUploadCommand, AbortMultipartUploadCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
    }
}
const client = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_S3_ENDPOINT,
    credentials: { accessKeyId: process.env.B2_APPLICATION_KEY_ID, secretAccessKey: process.env.B2_APPLICATION_KEY },
});
const Bucket = process.env.B2_BUCKET_NAME;

const listCount = async () => (await client.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1000 }))).Contents?.length ?? -1;

console.log("objects before:", await listCount());

// --- Test 1: true zero-byte PutObject ---
const key1 = "profiles/zz-probe-zerobyte";
const created1 = Date.now();
try {
    const r = await client.send(new PutObjectCommand({ Bucket, Key: key1, Body: Buffer.alloc(0), ContentType: "video/mp4" }));
    console.log("zero-byte PutObject OK, versionid-ish:", {
        etag: r.ETag,
    });
} catch (e) {
    console.log("zero-byte PutObject FAILED:", e.name, e.message);
}
console.log("objects after zero-byte put:", await listCount());

// --- Test 2: unfinished multipart session ---
const key2 = "profiles/zz-probe-unfinished-mpu";
let uploadId = null;
try {
    const c = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: key2, ContentType: "video/mp4" }));
    uploadId = c.UploadId;
    console.log("CreateMultipartUpload OK, UploadId created (redacted), Initiated:", c.Initiated?.toISOString());
} catch (e) {
    console.log("CreateMultipartUpload FAILED:", e.name, e.message);
}
console.log("objects after MPU create:", await listCount());

// native visibility check while session open
{
    const basic = Buffer.from(`${process.env.B2_APPLICATION_KEY_ID}:${process.env.B2_APPLICATION_KEY}`).toString("base64");
    const auth = await (await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", { headers: { Authorization: `Basic ${basic}` } })).json();
    const names = await (await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
        method: "POST", headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId: auth.allowed.bucketId, prefix: "profiles/zz-probe", maxFileCount: 100 }),
    })).json();
    console.log("native list of zz-probe while MPU open:", JSON.stringify((names.files ?? []).map(f => `${f.contentLength}B ${f.fileName}`)));
    const vers = await (await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_versions`, {
        method: "POST", headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId: auth.allowed.bucketId, prefix: "profiles/zz-probe", maxFileCount: 100 }),
    })).json();
    console.log("native versions of zz-probe:", JSON.stringify((vers.versions ?? []).map(f => `${f.action} ${f.contentLength}B ${f.fileName}`)));
    // verify the API text of the empty-put object
    for (const f of names.files ?? []) if (f.fileName === key1) console.log("zero-byte object IS listable via native API:", f.fileName, f.contentLength, "B");
}

// --- cleanup ---
const del = await client.send(new DeleteObjectCommand({ Bucket, Key: key1 }));
console.log("cleaned zero-byte probe object (deleted):", key1);
if (uploadId) {
    await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key2, UploadId: uploadId }));
    console.log("cleaned unfinished MPU session (aborted):", key2);
}
console.log("objects at end:", await listCount());
