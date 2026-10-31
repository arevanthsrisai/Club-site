// B2 native API: authorize with the application key and print ONLY non-secret
// authorization metadata (capabilities, bucket, prefix restriction).
// Never prints the auth token or key.
import { readFileSync } from "node:fs";

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
    }
}

const keyId = process.env.B2_APPLICATION_KEY_ID;
const appKey = process.env.B2_APPLICATION_KEY;
const basic = Buffer.from(`${keyId}:${appKey}`).toString("base64");

const apiBase = process.env.B2_NATIVE_API_URL || "https://api.backblazeb2.com";
const res = await fetch(`${apiBase}/b2api/v2/b2_authorize_account`, {
    headers: { Authorization: `Basic ${basic}` },
});
if (!res.ok) {
    console.log("authorize failed:", res.status, await res.text());
    process.exit(1);
}
const data = await res.json();
console.log("account:", data.accountId);
console.log("apiUrl:", data.apiUrl);
console.log("downloadUrl:", data.downloadUrl);
console.log("s3ApiUrl:", data.s3ApiUrl);
console.log("capabilities:", JSON.stringify(data.allowed?.capabilities));
console.log("bucketId:", data.allowed?.bucketId);
console.log("bucketName:", data.allowed?.bucketName);
console.log("fileNamePrefix:", JSON.stringify(data.allowed?.fileNamePrefix));
console.log("absoluteMinimumPartSize:", data.absoluteMinimumPartSize);
console.log("recommendedPartSize:", data.recommendedPartSize);

// List file versions natively (reveals delete markers / prior versions).
const verRes = await fetch(`${data.apiUrl}/b2api/v2/b2_list_file_versions`, {
    method: "POST",
    headers: { Authorization: data.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId: data.allowed?.bucketId, maxFileCount: 1000 }),
});
console.log("\nb2_list_file_versions status:", verRes.status);
if (verRes.ok) {
    const ver = await verRes.json();
    for (const f of ver.versions ?? []) {
        console.log(`${f.action.padEnd(7)} ${f.contentLength} B  ${new Date(f.uploadTimestamp).toISOString()}  ${f.fileName}`);
    }
    console.log("total versions:", (ver.versions ?? []).length);
} else {
    console.log("versions failed:", await verRes.text());
}

// List UNFINISHED large-file sessions — these are what the web console's
// "Browse Files" page shows as ghost rows that never appear in file listings.
const mpuRes = await fetch(`${data.apiUrl}/b2api/v2/b2_list_unfinished_large_files`, {
    method: "POST",
    headers: { Authorization: data.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId: data.allowed?.bucketId, maxFileCount: 100 }),
});
console.log("\nb2_list_unfinished_large_files status:", mpuRes.status);
if (mpuRes.ok) {
    const mpu = await mpuRes.json();
    for (const f of mpu.files ?? []) {
        console.log(`UNFINISHED  ${new Date(f.uploadTimestamp).toISOString()}  ${f.fileName}  fileId=${f.fileId}  type=${f.contentType}  partsCount=${f.partCount ?? "?"}  (${(f.publishedAt || "")})`);
    }
    console.log("total unfinished:", (mpu.files ?? []).length);
} else {
    console.log("unfinished list failed:", await mpuRes.text());
}

// Try to HEAD the two zero-byte keys reported by the console (exact names truncated in the screenshot,
// so search by the visible uuid fragments using list with startFileName).
for (const frag of ["2891c3cd", "e439deb5"]) {
    const r = await fetch(`${data.apiUrl}/b2api/v2/b2_list_file_names`, {
        method: "POST",
        headers: { Authorization: data.authorizationToken, "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId: data.allowed?.bucketId, startFileName: `profiles/${frag}`, maxFileCount: 5, prefix: `profiles/${frag}` }),
    });
    const j = r.ok ? await r.json() : null;
    console.log(`\nsearch prefix profiles/${frag}:`, r.status, j ? JSON.stringify(j.files?.map(f => `${f.contentLength}B ${f.fileName}`)) : await r.text());
}

const listRes = await fetch(`${data.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: "POST",
    headers: { Authorization: data.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId: data.allowed?.bucketId ?? undefined, maxFileCount: 1000 }),
});
console.log("\nb2_list_file_names status:", listRes.status);
if (listRes.ok) {
    const list = await listRes.json();
    for (const f of list.files ?? []) {
        console.log(`${f.contentLength} B  ${new Date(f.uploadTimestamp).toISOString()}  ${f.fileName} TEMPLATE:${f.fileInfo?.["src_last_modified_millies"] ?? "-"}`);
    }
    console.log("total:", (list.files ?? []).length, "nextFileName:", list.nextFileName ?? "(none)");
} else {
    console.log("list failed:", await listRes.text());
}
