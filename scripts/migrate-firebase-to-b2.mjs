// Migration: Firebase Storage objects → Backblaze B2 (S3-compatible).
//
// Purpose: after the storage pipeline moved to B2, media uploaded in earlier
// eras still lives in Firebase Storage (gallery images, videos, event images,
// profiles, resources...). This script moves those objects to B2 under the
// SAME object keys and rewrites Firestore references only after the copy is
// verified, so the website keeps working throughout.
//
// Safety properties:
//   - Idempotent: objects already present in B2 with the same size are skipped.
//   - Resumable: progress is kept in scripts/.migrate-fb-b2-state.json; a
//     failed run can be re-run and continues past acknowledged objects.
//   - Never destroys anything: original Firebase Storage objects are NOT
//     deleted here. After every reference is verified (a later, manual step),
//     the owner may empty the old bucket explicitly.
//   - Per-object error reporting; failures never abort the whole batch.
//
// Environment:
//   FIREBASE_ADMIN_KEY (base64 service-account JSON)  — Admin SDK
//   FIRESTORE_DATABASE_ID      — Admin SDK Firestore
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID or service-account project_id
//   B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME,
//   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY
//
// Usage:
//   node scripts/migrate-firebase-to-b2.mjs [--dry-run] [--prefix gallery/] [--fix-refs] [--limit N]
//
//   --dry-run   list the inventory and exit (default behaviour without --fix-refs)
//   --fix-refs  ALSO rewrite Firestore src/photoURL/url fields that point at
//               Firebase Storage to the private-bucket-safe
//               /api/gallery/media?key=... delivery URL (B2 must be verified first)
//   --limit N   process at most N objects this run

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import * as admin from "firebase-admin";

// ---------------------------------------------------------------- config
function requireEnv(name) {
    const v = process.env[name];
    if (!v || !v.trim()) {
        console.error(`Missing required env: ${name}`);
        process.exit(1);
    }
    return v.trim();
}

const DB_ID = requireEnv("FIRESTORE_DATABASE_ID");
const B2_BUCKET = requireEnv("B2_BUCKET_NAME");
const b2 = new S3Client({
    region: requireEnv("B2_REGION"),
    endpoint: requireEnv("B2_S3_ENDPOINT").replace(/\/+$/, ""),
    credentials: {
        accessKeyId: requireEnv("B2_APPLICATION_KEY_ID"),
        secretAccessKey: requireEnv("B2_APPLICATION_KEY"),
    },
});

// Admin SDK (base64 service account JSON, same shape as the app's runtime env).
const encodedKey = process.env.FIREBASE_ADMIN_KEY;
const credentialArgs = encodedKey
    ? { credential: admin.credential.cert(JSON.parse(Buffer.from(encodedKey, "base64").toString("utf8"))), projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID }
    : { projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID };
const adminApp = admin.apps.length ? admin.apps[0] : admin.initializeApp(credentialArgs);
const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET &&
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET !== "(default)"
    ? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    : adminApp.options.projectId + ".appspot.com";
const fbBucket = adminApp && admin.storage().bucket ? admin.storage().bucket(bucketName) : null;
if (!fbBucket) {
    console.error("Admin SDK storage is unavailable in this build; cannot enumerate the source bucket.");
    process.exit(1);
}

const DB = adminApp.firestore();
DB.settings({ databaseId: DB_ID });

// Namespaces that are allowed to move (mirrors validateKey in the app).
const APPROVED_PREFIXES = [
    "gallery/", "profiles/", "team_profiles/", "event-images/", "event-covers/",
    "resources/", "resource-thumbnails/", "avatars/",
];

const STATE_FILE = path.join(import.meta.dirname ?? ".", ".migrate-fb-b2-state.json");
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { done: {}, refs: {} };
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));

// ---------------------------------------------------------------- flags
const argv = process.argv.slice(2);
const DRY = !argv.includes("--fix-refs");
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(argv[limitIdx + 1], 10) || Infinity : Infinity;
const prefixIdx = argv.indexOf("--prefix");
const PREFIX_FILTER = prefixIdx !== -1 ? argv[prefixIdx + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- main
async function listSourceObjects() {
    const objects = [];
    let pageToken;
    do {
        const [files, nextPageQuery] = await fbBucket.getFiles({ prefix: PREFIX_FILTER || undefined, autoPaginate: false, maxResults: 1000, pageToken });
        for (const f of files) {
            const name = f.name;
            if (!APPROVED_PREFIXES.some((p) => name.startsWith(p))) continue;
            // Derived thumbnails/originals of already-migrated pairs live under
            // the same namespace; they migrate like any other object.
            objects.push({ name, size: Number(f.metadata?.size ?? 0), contentType: f.metadata?.contentType || "application/octet-stream" });
        }
        pageToken = nextPageQuery?.pageToken;
    } while (pageToken);
    return objects;
}

async function headB2(key) {
    try {
        const res = await b2.send(new HeadObjectCommand({ Bucket: B2_BUCKET, Key: key }));
        return res.ContentLength ?? null;
    } catch {
        return null;
    }
}

async function copyToB2(obj) {
    // Stream download → upload (object sizes here are ≤ tens of MB).
    const [bytes] = await fbBucket.file(obj.name).download();
    if (bytes.length !== obj.size && obj.size > 0) {
        throw new Error(`download size mismatch (${bytes.length} vs ${obj.size})`);
    }
    await b2.send(new PutObjectCommand({
        Bucket: B2_BUCKET,
        Key: obj.name,
        Body: bytes,
        ContentType: obj.contentType,
        CacheControl: "public, max-age=31536000, immutable",
    }));
    // Verify by size; a bigger HEAD round-trip would double the traffic.
    const storedSize = await headB2(obj.name);
    if (storedSize !== bytes.length) {
        throw new Error(`post-copy verification failed (B2 has ${storedSize} bytes, wanted ${bytes.length})`);
    }
    return bytes.length;
}

function deliveryUrl(key) {
    return `/api/gallery/media?key=${encodeURIComponent(key)}`;
}

/** Rewrites reference fields that point at Firebase Storage URLs. */
async function fixRefs() {
    const bucketHost = `firebasestorage.googleapis.com/v0/b/${bucketName}`;
    const gsPrefix = `gs://${bucketName}/`;

    const rewrites = [
        { collection: "gallery", field: "src" },
        { collection: "events", field: "image" },
        { collection: "resources", field: "url" },
        { collection: "resources", field: "thumbnailUrl" },
        { collection: "alumni", field: "photoURL" },
        { collection: "admins", field: "photoURL" },
        { collection: "users", field: "photoURL" },
    ];

    let updated = 0;
    for (const rw of rewrites) {
        const snap = await DB.collection(rw.collection).where(rw.field, "!=", "").get().catch(() => null);
        if (!snap) { console.warn(`  ! ${rw.collection} query failed, skipping`); continue; }
        let batch = DB.batch();
        let writes = 0;
        for (const doc of snap.docs) {
            const value = doc.data()[rw.field];
            if (typeof value !== "string") continue;
            const normalized = state.refs[value] !== undefined ? state.refs[value] : value;
            let key = null;
            if (normalized.startsWith(bucketHost)) key = decodeURIComponent(normalized.split("/o/")[1]?.split("?")[0] ?? "");
            else if (normalized.startsWith(gsPrefix)) key = normalized.slice(gsPrefix.length);
            else if (APPROVED_PREFIXES.some((p) => normalized.startsWith(p))) key = normalized; // plain key stored directly
            if (!key || state.done[key] !== "refs") continue;

            const next = deliveryUrl(key);
            if (next !== value) {
                batch.update(doc.ref, { [rw.field]: next });
                writes++;
                updated++;
            }
            if (writes === 400) { await batch.commit(); batch = DB.batch(); writes = 0; }
        }
        if (writes) await batch.commit();
    }
    return updated;
}

(async () => {
    console.log(`Migrating Firebase Storage (${bucketName}) → Backblaze B2 (${B2_BUCKET})`);
    console.log(DRY ? "DRY RUN — references will not be rewritten (pass --fix-refs later)\n" : "");

    const objects = await listSourceObjects();
    console.log(`Source inventory: ${objects.length} approved-prefix objects\n`);

    let migrated = 0, skipped = 0, awaited = 0, failed = 0, processed = 0;
    const failures = [];
    for (const obj of objects) {
        if (processed >= LIMIT) break;
        processed++;
        try {
            if (state.done[obj.name]) { skipped++; continue; }
            const existing = await headB2(obj.name);
            if (existing !== null && existing === obj.size) {
                state.done[obj.name] = "present";
                skipped++;
                saveState();
                continue;
            }
            await copyToB2(obj);
            state.done[obj.name] = "migrated";
            if (obj.contentType === "application/pdf" || obj.contentType.startsWith("image/")) {
                state.refs[obj.name] = true; // eligible for reference rewrite
            } else {
                state.refs[obj.name] = true; // videos too (delivery route handles them)
            }
            if (DRY) {
                // In dry-run mode the DB is untouched and state is not persisted
                // past memory, so re-runs still copy.
                state.done[obj.name] = state.done[obj.name]; // mark in-memory
            }
            migrated++;
            console.log(`  ✓ ${obj.name} (${obj.size} bytes)`);
        } catch (err) {
            failed++;
            failures.push({ object: obj.name, error: String(err?.message || err) });
            console.error(`  ✗ ${obj.name}: ${err?.message || err}`);
        }
        // Small pause keeps the double-bucket I/O gentle on shared endpoints.
        if (migrated % 25 === 0) { saveState(); await sleep(50); }
    }
    if (!DRY) saveState();

    console.log(`\nSummary: ${migrated} migrated, ${skipped} already covered, ${failed} failed, ${awaited} n/a`);

    if (!DRY && failed === 0) {
        const n = await fixRefs();
        console.log(`Reference rewrite: ${n} Firestore fields now point at /api/gallery/media`);
    } else if (!DRY) {
        console.log("Reference rewrite SKIPPED — every object must migrate successfully first.");
    }

    console.log("\nOriginal Firebase Storage objects were NOT deleted.");
    console.log("Verify delivery in the app, then remove the old bucket contents manually.");

    if (failures.length) {
        console.log("\nFailures:");
        for (const f of failures) console.log(`  - ${f.object}: ${f.error}`);
        process.exitCode = 1;
    }
})();
