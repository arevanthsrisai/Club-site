import fs from "node:fs";
import admin from "firebase-admin";

// Load env
const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
const env = {};
for (const l of lines) {
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); env[m[1]] = v; }
}
const key = JSON.parse(Buffer.from(env.FIREBASE_ADMIN_KEY, "base64").toString("utf8"));

admin.initializeApp({ credential: admin.cert(key) });
const auth = admin.auth();
const db = admin.firestore();

const email = "relu-test-cto@example.com";
const password = "TestPass123!@#";

let user;
try {
    user = await auth.getUserByEmail(email);
    console.log("user exists", user.uid);
} catch (e) {
    user = await auth.createUser({ email, password, displayName: "ReLU Test CTO" });
    console.log("created user", user.uid);
}

const uid = user.uid;
await db.collection("admins").doc(uid).set({
    uid, email, role: "CTO", status: "active", displayName: "ReLU Test CTO",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
}, { merge: true });
console.log("admin doc set");

// Write credentials to temp file
const out = { uid, email, password };
fs.writeFileSync("C:/Users/Revanth/AppData/Local/Temp/opencode/test-cto.json", JSON.stringify(out));
console.log("DONE");
process.exit(0);