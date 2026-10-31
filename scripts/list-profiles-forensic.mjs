// Forensic listing: profiles/ (and sibling prefixes) with full key, size, timestamps.
// Read-only. Never deletes anything.
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
    }
}
console.log("Bucket in .env.local:", process.env.B2_BUCKET_NAME);
console.log("Region:", process.env.B2_REGION, "Endpoint:", process.env.B2_S3_ENDPOINT);
const keyId = process.env.B2_APPLICATION_KEY_ID || "";
console.log("Key ID prefix:", keyId.slice(0, 8) + "…");

const client = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.B2_APPLICATION_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY,
    },
});

const prefixes = process.argv[2] === "--all" ? [""] : ["profiles/"];
for (const prefix of prefixes) {
    let token;
    let count = 0;
    console.log(`\n=== ${prefix} ===`);
    do {
        const res = await client.send(new ListObjectsV2Command({
            Bucket: process.env.B2_BUCKET_NAME,
            Prefix: prefix,
            MaxKeys: 1000,
            ...(token ? { ContinuationToken: token } : {}),
        }));
        for (const o of res.Contents ?? []) {
            count++;
            console.log(`${o.Size.toString().padStart(9)} B  ${o.LastModified.toISOString()}  ${o.Key}  etag=${(o.ETag || "").replace(/"/g, "")}`);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    console.log(`total: ${count}`);
}
