#!/usr/bin/env node
/**
 * Production server startup script for Next.js standalone output.
 *
 * `next start` does not work with `output: "standalone"`, so we run the
 * built standalone server directly: `node .next/standalone/server.js`.
 *
 * This preserves compatibility with the existing VPS/PM2/nginx deployment
 * and keeps the standalone architecture intact.
 *
 * NOTE: Next.js standalone output does not automatically copy `public/images/`
 * or `public/founders/` into the output, and it omits the `_next/static/`
 * directory that the running server needs for JS/CSS chunks and fonts. This
 * script ensures all of those are present before starting the server.
 */

import { fileURLToPath } from "node:url";
import {
    existsSync,
    mkdirSync,
    copyFileSync,
    readFileSync,
    readdirSync,
    unlinkSync,
    rmdirSync,
} from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const __dirname = fileURLToPath(import.meta.url);
const repoRoot = path.dirname(path.dirname(__dirname));
const standaloneDir = path.join(repoRoot, ".next", "standalone");
const publicDir = path.join(repoRoot, "public");
const serverPath = path.join(standaloneDir, "server.js");

if (!existsSync(serverPath)) {
    console.error("Production build not found. Run `npm run build` first.");
    process.exit(1);
}

// Recursively remove a directory tree (best-effort).
function rmdirRecursive(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            rmdirRecursive(p);
        } else {
            try {
                unlinkSync(p);
            } catch {}
        }
    }
    try {
        rmdirSync(dir);
    } catch {}
}

// Recursively copy a source tree into a destination.
function copyTree(src, dest) {
    if (!existsSync(src)) {
        console.warn(`Source directory not found: ${src} — skipping copy.`);
        return;
    }
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyTree(s, d);
        } else {
            copyFileSync(s, d);
        }
    }
}

// Ensure the whole public/ tree (e.g. images/, images/founders/, avatars/) is
// copied into the standalone output. The standalone build does not copy
// `public/` into the output, so we always copy it explicitly. We remove the
// destination first so the copy is always fresh and never serves stale assets.
if (existsSync(publicDir)) {
    const publicDest = path.join(standaloneDir, "public");
    rmdirRecursive(publicDest);
    copyTree(publicDir, publicDest);
}

// Copy _next/static/ (JS/CSS chunks, fonts, images) into the standalone output.
// The standalone server resolves these from its own dir, so they must be present.
const staticSrc = path.join(repoRoot, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
if (existsSync(staticSrc)) {
    copyTree(staticSrc, staticDest);
}

// Load environment files into process.env before the standalone server starts.
// The standalone server.js does `process.chdir(__dirname)` and never reads the
// repo-root .env.local, so server-only variables (FIRESTORE_DATABASE_ID,
// FIREBASE_ADMIN_KEY, B2_*, ...) must be provided here. Real environment
// variables (PM2/systemd/Cloud Run) always take precedence over file values.
for (const envName of [".env", ".env.local"]) {
    const envPath = path.join(repoRoot, envName);
    if (!existsSync(envPath)) continue;
    try {
        const fileVars = parseEnv(readFileSync(envPath, "utf8"));
        for (const [key, value] of Object.entries(fileVars)) {
            if (process.env[key] === undefined || process.env[key] === "") {
                process.env[key] = value;
            }
        }
    } catch (error) {
        console.error(`Failed to parse ${envName}:`, error.message);
        process.exit(1);
    }
}

// Default to 3000 if PORT is not set by the environment (e.g. Cloud Run).
const port = process.env.PORT || "3000";
process.env.PORT = port;

// Use createRequire for cross-platform ESM module loading.
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
require(serverPath);