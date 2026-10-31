// Mint a Firebase custom token for one existing approved admin and swap it for
// a REAL ID token compatible with the app's verifyAuthToken, then exercise the
// RUNNING app's /api/media/upload route (same route the browser uses).
// Credentials come from .env.local (FIREBASE_ADMIN_KEY). No secret output.
import { readFileSync } from "node:fs";
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
    }
}
const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_KEY, "base64").toString("utf8"));

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");

const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const auth = getAuth(app);

const admins = await db.collection("admins").get();
console.log("admins found:", admins.size);
let chosen = null;
for (const doc of admins.docs) {
    const d = doc.data();
    const status = d.status ?? "(none)";
    console.log("  isAdminDoc:", !!doc.id, "role-set:", !!d.role, "status:", status);
    if (status === "active") chosen = chosen ?? doc;
}
if (!chosen) { console.log("NO ACTIVE ADMIN FOUND — cannot mint token"); process.exit(2); }
const uid = chosen.id;
const customToken = await auth.createCustomToken(uid);
console.log("custom token minted for an approved, active admin (uid redacted)");

const swap = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
if (!swap.ok) { console.log('swap failed:', swap.status, await swap.text()); process.exit(1); }
const data = await swap.json();
console.log('ID_TOKEN obtained (redacted, length=' + data.idToken.length + ')');

// Write nothing to disk; hand the token to the lifecycle test via stdout? No —
// keep tokens out of shell history: pass via a temp file that is deleted after.
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const tf = join(tmpdir(), "relu-admin-idtoken.tmp");
writeFileSync(tf, data.idToken);
console.log("token staged at tmp file (deleted after use):", tf);
