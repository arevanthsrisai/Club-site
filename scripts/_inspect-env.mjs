import fs from "node:fs";
const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const l of lines) {
    const m = l.match(/^FIREBASE_ADMIN_KEY\s*=\s*(.*)$/);
    if (m) {
        let v = m[1].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        console.log("len", v.length, "starts", v.slice(0, 30));
    }
}