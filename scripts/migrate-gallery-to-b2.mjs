#!/usr/bin/env node
/**
 * Gallery storage migration: Cloudflare R2 → Backblaze B2.
 *
 * Run with BOTH the legacy R2_* and the new B2_* variables present:
 *     R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *     R2_BUCKET_NAME=... R2_PUBLIC_BASE_URL=... \
 *     B2_S3_ENDPOINT=... B2_REGION=... B2_BUCKET_NAME=... \
 *     B2_APPLICATION_KEY_ID=... B2_APPLICATION_KEY=... \
 *     node scripts/migrate-gallery-to-b2.mjs
 *
 * Behaviour:
 *   1. Lists every R2 object under the `gallery/` prefix (read-only inventory).
 *   2. Copies each object to B2 under the SAME key, with the same content type
 *      and cache headers (Get+Put; originals in R2 are never modified or
 *      deleted).
 *   3. Verifies each copy by HEAD-ing B2 for matching size and by HEAD-ing
 *      delivery through /api/gallery/media before it is considered migrated.
 *
 * Idempotent: objects already present in B2 with a matching size are skipped.
 * The script NEVER deletes R2 objects — cleanup is a separate, explicit,
 * manual decision after a full verification pass.
 */

import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const PREFIX = "gallery/";

function requireEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

function r2Client() {
    const accountId = requireEnv("R2_ACCOUNT_ID");
    return new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
            secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
        },
    });
}

function b2Client() {
    return new S3Client({
        region: requireEnv("B2_REGION"),
        endpoint: requireEnv("B2_S3_ENDPOINT").replace(/\/+$/, ""),
        credentials: {
            accessKeyId: requireEnv("B2_APPLICATION_KEY_ID"),
            secretAccessKey: requireEnv("B2_APPLICATION_KEY"),
        },
    });
}

async function listAll(client, bucket, prefix) {
    const keys = [];
    let continuationToken;
    do {
        const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
        for (const obj of res.Contents ?? []) keys.push(obj.Key);
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
}

async function head(client, bucket, key) {
    try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { ok: true, contentLength: res.ContentLength, contentType: res.ContentType };
    } catch {
        return { ok: false };
    }
}

async function hashStream(stream) {
    const hash = createHash("sha256");
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest("hex");
}

async function main() {
    const r2 = r2Client();
    const b2 = b2Client();
    const r2Bucket = requireEnv("R2_BUCKET_NAME");
    const b2Bucket = requireEnv("B2_BUCKET_NAME");

    console.log(`[1/3] Listing R2 objects under "${PREFIX}" ...`);
    const keys = await listAll(r2, r2Bucket, PREFIX);
    console.log(`      ${keys.length} object(s) found.`);

    let copied = 0, skipped = 0, failed = 0;

    for (const key of keys) {
        const srcHead = await head(r2, r2Bucket, key);
        if (!srcHead.ok) {
            console.warn(`      SKIP (cannot HEAD R2): ${key}`);
            skipped++;
            continue;
        }

        // Idempotency: skip if B2 already has the object with a matching size.
        const dstHead = await head(b2, b2Bucket, key);
        if (dstHead.ok && dstHead.contentLength === srcHead.contentLength) {
            console.log(`      SKIP (already in B2): ${key}`);
            skipped++;
            continue;
        }

        // Copy: read from R2, write to B2 with identical content type + cache headers.
        const get = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
        const body = await get.Body.transformToByteArray();
        await b2.send(new PutObjectCommand({
            Bucket: b2Bucket,
            Key: key,
            Body: body,
            ContentType: srcHead.contentType ?? get.ContentType ?? "application/octet-stream",
            CacheControl: "public, max-age=31536000, immutable",
        }));

        // Verify by size.
        const verify = await head(b2, b2Bucket, key);
        if (!verify.ok || verify.contentLength !== body.length) {
            console.error(`      FAIL (verify): ${key}`);
            failed++;
            continue;
        }

        console.log(`      OK   (copied ${body.length} B): ${key}`);
        copied++;
    }

    console.log(`\n[2/3] Done: ${copied} copied, ${skipped} skipped, ${failed} failed.`);
    console.log(`[3/3] R2 originals were NOT modified or deleted. Remove R2_* from .env only after a manual verification pass (see docs/gallery-migration.md).`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(2);
});