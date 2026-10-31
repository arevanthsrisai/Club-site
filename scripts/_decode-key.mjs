import fs from "node:fs";
const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
let v = "";
for (const l of lines) {
    const m = l.match(/^FIREBASE_ADMIN_KEY\s*=\s*(.*)$/);
    if (m) { v = m[1].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); }
}
let json;
try { json = JSON.parse(v); console.log("direct json ok", json.project_id); }
catch (e) {
    try { json = JSON.parse(Buffer.from(v, "base64").toString("utf8")); console.log("base64 json ok", json.project_id); }
    catch (e2) { console.log("decode failed", e.message, e2.message); }
}