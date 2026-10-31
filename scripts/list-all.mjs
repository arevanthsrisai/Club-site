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

const client = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.B2_APPLICATION_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY,
    },
});

const prefixes = ["profiles/", "team_profiles/", "avatars/", "gallery/", "event-images/", "event-covers/", "resources/", "resource-thumbnails/"];
for (const prefix of prefixes) {
    const res = await client.send(new ListObjectsV2Command({
        Bucket: process.env.B2_BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: 100,
    }));
    const zeroByte = (res.Contents || []).filter(o => o.Size === 0);
    const total = res.Contents?.length || 0;
    if (zeroByte.length > 0) {
        console.log(`\n⚠️ ${prefix}: ${total} objects, ${zeroByte.length} zero-byte`);
        for (const obj of zeroByte) {
            console.log(`   ZERO: ${obj.Key} — LastModified: ${obj.LastModified}`);
        }
    } else {
        console.log(`${prefix}: ${total} objects, 0 zero-byte`);
    }
}
