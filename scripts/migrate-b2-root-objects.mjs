#!/usr/bin/env node
/**
 * B2 Root-Level Object Migration
 *
 * Inspects the reluwebsite bucket for objects stored at the root level
 * (without a purpose-specific prefix) and copies them to their correct
 * purpose-specific prefix (profiles/, avatars/, team_profiles/, etc.).
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-b2-root-objects.mjs   # Dry-run by default
 *   DRY_RUN=false node scripts/migrate-b2-root-objects.mjs  # Execute copy
 *
 * Behaviour:
 *   1. Lists all objects at the bucket root (keys without a '/' delimiter).
 *   2. For each root-level object, determines the destination prefix via
 *      source-to-destination mapping (see MAPPING below).
 *   3. Copies each object to B2 under the new prefix with the same content
 *      type and cache headers (Get+Put; originals are NOT modified or deleted).
 *   4. Verifies each copy by HEAD-ing B2 for matching size.
 *   5. Reports per-object success/failure and a migration manifest.
 *
 * Idempotent: objects already present at the destination with matching size
 * are skipped. Original root-level objects are NEVER modified or deleted —
 * cleanup is a separate, explicit decision after a full verification pass.
 * Firestore references are NOT rewritten by this script: they remain valid
 * only if the object key stays accessible. Updating references in Firestore
 * must be done separately after migration verification.
 *
 * Required env vars:
 *   B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME,
 *   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY
 */

import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Source-to-destination mapping for root-level objects.
 *
 * Root-level keys have no '/' so we cannot inspect a prefix. The destination
 * is determined heuristically by file extension/content type:
 *   - images  -> profiles/   (default for profile-type photos at root)
 *   - videos  -> event-images/ (event media)
 *   - pdfs    -> resources/
 *   - other   -> profiles/   (fallback, safest non-colliding namespace)
 *
 * The mapping must be customized based on actual bucket contents. Edit this
 * object to match your application's needs.
 */
const EXT_TO_PREFIX = {
  ".jpg": "profiles",
  ".jpeg": "profiles",
  ".png": "profiles",
  ".webp": "profiles",
  ".gif": "profiles",
  ".avif": "profiles",
  ".mp4": "event-images",
  ".webm": "event-images",
  ".pdf": "resources",
};

const DRY_RUN = process.env.DRY_RUN !== "false";
const b2Client = new S3Client({
  region: requireEnv("B2_REGION"),
  endpoint: requireEnv("B2_S3_ENDPOINT").replace(/\/+$/, ""),
  credentials: {
    accessKeyId: requireEnv("B2_APPLICATION_KEY_ID"),
    secretAccessKey: requireEnv("B2_APPLICATION_KEY"),
  },
});

const b2Bucket = requireEnv("B2_BUCKET_NAME");

async function head(client, bucket, key) {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { ok: true, contentLength: res.ContentLength, contentType: res.ContentType };
  } catch {
    return { ok: false };
  }
}

async function listAll(client, bucket) {
  const keys = [];
  let continuationToken;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    );
    for (const obj of res.Contents ?? []) keys.push(obj.Key);
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function main() {
  console.log(`[Migration] Mode: ${DRY_RUN ? "DRY-RUN (no writes)" : "LIVE (copying objects)"}`);
  console.log(`[Migration] Bucket: ${b2Bucket}`);

  console.log("[1/4] Listing all objects in bucket ...");
  const allKeys = await listAll(b2Client, b2Bucket);
  console.log(`      ${allKeys.length} object(s) found.`);

  // Separate root-level objects (no '/') from prefixed objects.
  const rootKeys = allKeys.filter((k) => !k.includes("/"));
  const prefixedKeys = allKeys.filter((k) => k.includes("/"));

  console.log(`      ${prefixedKeys.length} prefixed object(s) (already organized).`);
  console.log(`      ${rootKeys.length} root-level object(s) need migration.`);

  if (rootKeys.length === 0) {
    console.log("\n[Migration] No root-level objects found. Nothing to migrate.");
    process.exit(0);
  }

  let copied = 0, skipped = 0, failed = 0;
  const manifest = [];

  console.log(`\n[2/4] Processing ${rootKeys.length} root-level object(s) ...`);
  for (const sourceKey of rootKeys) {
    const srcHead = await head(b2Client, b2Bucket, sourceKey);
    if (!srcHead.ok) {
      console.warn(`      SKIP (cannot HEAD): ${sourceKey}`);
      manifest.push({ source: sourceKey, destination: "", status: "skipped", error: "cannot HEAD source" });
      failed++;
      continue;
    }

    // Determine destination prefix from file extension.
    const ext = sourceKey.toLowerCase().replace(/.*\./, ".") || ".bin";
    const destPrefix = EXT_TO_PREFIX[ext] || "profiles";
    const destinationKey = `${destPrefix}/${sourceKey}`;

    // Idempotency: skip if destination already exists with matching size.
    const dstHead = await head(b2Client, b2Bucket, destinationKey);
    if (dstHead.ok && dstHead.contentLength === srcHead.contentLength) {
      console.log(`      SKIP (already at destination): ${destinationKey}`);
      manifest.push({ source: sourceKey, destination: destinationKey, status: "skipped", size: srcHead.contentLength });
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`      WOULD COPY: ${sourceKey} -> ${destinationKey} (${srcHead.contentLength} bytes)`);
      manifest.push({ source: sourceKey, destination: destinationKey, status: "would-copy", size: srcHead.contentLength });
      copied++;
      continue;
    }

    // Copy: read from B2 root, write to B2 under correct prefix.
    const get = await b2Client.send(new GetObjectCommand({ Bucket: b2Bucket, Key: sourceKey }));
    const body = await get.Body.transformToByteArray();
    await b2Client.send(
      new PutObjectCommand({
        Bucket: b2Bucket,
        Key: destinationKey,
        Body: body,
        ContentType: srcHead.contentType ?? get.ContentType ?? "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    // Verify by size.
    const verify = await head(b2Client, b2Bucket, destinationKey);
    if (!verify.ok || verify.contentLength !== body.length) {
      console.error(`      FAIL (verify): ${destinationKey}`);
      manifest.push({ source: sourceKey, destination: destinationKey, status: "failed", error: "verification failed" });
      failed++;
      continue;
    }

    console.log(`      OK   (copied ${body.length} B): ${sourceKey} -> ${destinationKey}`);
    manifest.push({ source: sourceKey, destination: destinationKey, status: "copied", size: body.length });
    copied++;
  }

  // Write manifest to stdout (JSON) for tooling consumption.
  console.log("\n[3/4] Migration summary:");
  console.log(`      Copied: ${copied}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(JSON.stringify({ rootLevelObjects: rootKeys.length, results: manifest }, null, 2));

  console.log("\n[4/4] Next steps:");
  console.log("   - Review the manifest above for each object's source->destination mapping.");
  console.log("   - Run with DRY_RUN=false to execute the copy (originals are preserved).");
  console.log("   - After verification, update Firestore references from old keys to new keys.");
  console.log("   - Delete original root-level objects only after explicit authorization.");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(2);
});
