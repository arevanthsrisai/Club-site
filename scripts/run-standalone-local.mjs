// Local development helper: loads .env.local into the process environment and
// starts the standalone production server (next start is not compatible with
// output:"standalone"). On the VPS this is handled by systemd's
// /etc/relu-website/runtime.env instead — this helper is for local runs only
// and simply forwards what is already in the user's own env file.
//
// Usage: node scripts/run-standalone-local.mjs [PORT]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const port = process.argv[2] || "3000";

const env = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        env[m[1]] = v;
    }
}

const { spawn } = await import("node:child_process");
const child = spawn(process.execPath, [join(".next", "standalone", "server.js")], {
    env: { ...process.env, ...env, NODE_ENV: "production", PORT: port, HOSTNAME: "0.0.0.0" },
    stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
