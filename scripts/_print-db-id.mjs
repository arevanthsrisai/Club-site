import fs from "node:fs";
const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const l of lines) {
    const m = l.match(/^FIRESTORE_DATABASE_ID\s*=\s*(.*)$/);
    if (m) {
        let v = m[1].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        console.log(v);
    }
}