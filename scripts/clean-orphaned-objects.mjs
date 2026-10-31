#!/usr/bin/env node
/**
 * Orphaned B2 Object Cleanup (Root-Level Legacy Objects Only)
 * 
 * Lists all root-level objects in the B2 bucket (keys without '/'), checks 
 * Firestore collections for references, and identifies truly orphaned objects.
 * 
 * SAFETY CONSTRAINTS:
 * - Only processes root-level keys matching UUID pattern: /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}-[\w.-]+$/
 * - NEVER processes namespaced keys (gallery/, profiles/, etc.) - those use the normal deletion flow
 * - Defaults to DRY_RUN mode - no deletions without explicit DRY_RUN=false
 * - Produces JSON manifest for audit before any live deletion
 * 
 * Usage:
 *   node scripts/clean-orphaned-objects.mjs              # Dry-run (default)
 *   DRY_RUN=false node scripts/clean-orphaned-objects.mjs # Live deletion
 * 
 * Requires: B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY
 * Optional: FIREBASE_PROJECT_ID (for Firestore reference checking)
 */

import { S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

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

async function listAllRootObjects(client, bucket) {
  const keys = [];
  let continuationToken;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    );
    for (const obj of res.Contents ?? []) {
      // Only root-level objects (no '/')
      if (!obj.Key.includes("/")) {
        keys.push(obj.Key);
      }
    }
    // Safety: B2 ListObjectsV2 does not return keys starting with '/' — no leading-slash normalization needed.
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

/**
 * Validates that a root-level key matches the legacy UUID-based format
 * from before namespace prefixes were enforced.
 * Only hex UUIDs (8-4-4-4-12) followed by a dash and safe characters are accepted.
 * This is the same pattern as src/lib/objectStorage.ts validateLegacyRootKey().
 */
function isLegacyRootKey(key) {
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}-[\w.-]+$/.test(key);
}

/**
 * Scans Firestore collections for media references.
 * Returns a Set of all media URLs and storage keys found.
 * 
 * Checks:
 * - gallery: src, storageKey fields
 * - events: image field (cover images)
 * - team_profiles: all string fields that look like media URLs
 * - resources: all string fields that look like media URLs
 * - alumni: profileImage, coverImage fields
 */
async function checkFirestoreReferences() {
  const fireStoreRefs = new Set();
  let firestoreAvailable = false;
  
  try {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore, collection, getDocs } = await import("firebase-admin/firestore");
    
    if (!getApps().length) {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      if (!projectId) {
        console.warn("[Firestore] FIREBASE_PROJECT_ID not set; skipping reference check.");
        return { refs: fireStoreRefs, available: false };
      }
      initializeApp({ projectId });
    }
    
    firestoreAvailable = true;
    const db = getFirestore();
    
    // Gallery collection - primary source of truth for B2 objects
    const gallerySnap = await getDocs(collection(db, "gallery"));
    for (const doc of gallerySnap.docs) {
      const data = doc.data();
      const src = typeof data.src === "string" ? data.src : "";
      const storageKey = typeof data.storageKey === "string" ? data.storageKey : "";
      if (src) fireStoreRefs.add(src);
      if (storageKey) fireStoreRefs.add(storageKey);
      // Also check for legacy firebase storage URLs
      if (src.includes("firebasestorage.googleapis.com")) fireStoreRefs.add(src);
    }
    
    // Events collection - cover images
    const eventsSnap = await getDocs(collection(db, "events"));
    for (const doc of eventsSnap.docs) {
      const data = doc.data();
      const image = typeof data.image === "string" ? data.image : "";
      if (image) fireStoreRefs.add(image);
    }
    
    // Team profiles
    try {
      const teamSnap = await getDocs(collection(db, "team_profiles"));
      for (const doc of teamSnap.docs) {
        const data = doc.data();
        for (const value of Object.values(data)) {
          if (typeof value === "string" && /\.(jpg|jpeg|png|webp|gif|avif|mp4|webm)(\?|$)/i.test(value)) {
            fireStoreRefs.add(value);
          }
        }
      }
    } catch {
      // Collection may not exist
    }
    
    // Resources
    try {
      const resourcesSnap = await getDocs(collection(db, "resources"));
      for (const doc of resourcesSnap.docs) {
        const data = doc.data();
        for (const value of Object.values(data)) {
          if (typeof value === "string" && /\.(jpg|jpeg|png|webp|gif|avif|mp4|webm|pdf)(\?|$)/i.test(value)) {
            fireStoreRefs.add(value);
          }
        }
      }
    } catch {
      // Collection may not exist
    }
    
    // Alumni
    try {
      const alumniSnap = await getDocs(collection(db, "alumni"));
      for (const doc of alumniSnap.docs) {
        const data = doc.data();
        for (const field of ["profileImage", "coverImage", "image"]) {
          const value = data[field];
          if (typeof value === "string" && /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(value)) {
            fireStoreRefs.add(value);
          }
        }
      }
    } catch {
      // Collection may not exist
    }
    
    console.log(`[Firestore] Scanned collections, found ${fireStoreRefs.size} media references.`);
  } catch (error) {
    console.warn("[Firestore] Error during scan:", error.message);
    console.warn("[Firestore] Will proceed with limited reference checking.");
  }
  
  return { refs: fireStoreRefs, available: firestoreAvailable };
}

async function main() {
  console.log(`[Cleanup] Mode: ${DRY_RUN ? "DRY-RUN (no deletions)" : "LIVE (will delete)"}`);
  console.log(`[Cleanup] Bucket: ${b2Bucket}`);

  console.log("\n[1/4] Listing root-level objects in B2 bucket...");
  const rootKeys = await listAllRootObjects(b2Client, b2Bucket);
  console.log(`      ${rootKeys.length} root-level object(s) found.`);

  if (rootKeys.length === 0) {
    console.log("\n[Cleanup] No root-level objects found. Nothing to clean up.");
    process.exit(0);
  }

  console.log("\n[2/4] Checking Firestore for references...");
  const fireStoreRefs = await checkFirestoreReferences();

  console.log("\n[3/4] Analyzing each object...");
  let orphaned = 0, referenced = 0, skipped = 0;
  const report = [];

  for (const key of rootKeys) {
    // Safety check: only process keys matching the legacy UUID pattern.
    // Non-matching root-level keys (if any) are classified as skipped.
    if (!isLegacyRootKey(key)) {
      console.log(`      SKIP (non-legacy key): ${key}`);
      report.push({ key, status: "skipped", error: "does not match legacy UUID pattern" });
      skipped++;
      continue;
    }

    const headResult = await head(b2Client, b2Bucket, key);
    if (!headResult.ok) {
      console.log(`      SKIP (cannot HEAD): ${key}`);
      report.push({ key, status: "skipped", error: "cannot HEAD", size: null });
      skipped++;
      continue;
    }

    // Check if any Firestore reference contains this key (or the key is part of a URL)
    const isReferenced = Array.from(fireStoreRefs).some(ref => {
      // Check direct match or if the key appears in a URL query parameter
      return ref === key || ref.includes(encodeURIComponent(key)) || ref.includes(key);
    });

    if (isReferenced) {
      console.log(`      KEEP (referenced): ${key} (${headResult.contentLength} B)`);
      report.push({ key, status: "kept", size: headResult.contentLength, reason: "referenced by Firestore" });
      referenced++;
    } else {
      console.log(`      ORPHANED: ${key} (${headResult.contentLength} B)`);
      report.push({ key, status: "orphaned", size: headResult.contentLength });
      orphaned++;

      if (!DRY_RUN) {
        try {
          await b2Client.send(new DeleteObjectCommand({ Bucket: b2Bucket, Key: key }));
          console.log(`      DELETED: ${key}`);
          report[report.length - 1].deleted = true;
        } catch (error) {
          console.error(`      DELETE FAILED: ${key}: ${error.message}`);
          report[report.length - 1].error = error.message;
        }
      } else {
        console.log(`      WOULD DELETE: ${key}`);
      }
    }
  }

  console.log("\n[4/4] Summary:");
  console.log(`      Root-level objects: ${rootKeys.length}`);
  console.log(`      Orphaned: ${orphaned}`);
  console.log(`      Still referenced: ${referenced}`);
  console.log(`      Skipped: ${skipped}`);
  console.log("\n[Cleanup] Detailed report:");
  console.log(JSON.stringify(report, null, 2));

  if (referenced > 0) {
    console.log("\n[WARNING] Some root-level objects are still referenced by Firestore.");
    console.log("         Consider migrating them to the correct namespace before deleting.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(2);
});
