# VPS deployment checklist — ReLU website on a single Ubuntu box

Target: one Ubuntu VPS behind Cloudflare. nginx serves static assets and
proxies to the Next.js standalone server on `127.0.0.1:3000`. The Node
process is supervised by systemd. Dockerfile / cloudbuild.yaml stay in the
repo untouched — they remain the Cloud Run artifact, not this runtime.

Phase-1 verification is designed to run fully on the VPS IP (no DNS yet).
Cloudflare + domain wiring is Phase 2.

## 0. Layout on the box

```
/opt/relu-website/
  repo/                          git clone of this repository
    .env.production.local        build-time NEXT_PUBLIC_* values (gitignored)
  releases/                      one immutable dir per build
    20261025-1530/               assembled standalone runtime
  current -> releases/20261025-1530   symlink nginx+systemd always read
/etc/relu-website/runtime.env     runtime secrets, root:root, 0600
/etc/nginx/…                      nginx site config + Cloudflare real-IP snippet
/etc/systemd/system/relu-website.service
```

User: a non-root deploy user, conventionally `relu`, member of no
sudo-privileged group except the single systemctl rule (§5).

## 1. Prerequisites (Ubuntu 22.04/24.04)

### 1a. Preflight (read-only, run before touching anything)

```bash
bash deploy/vps/scripts/preflight.sh
```

Read-only inventory of the box: OS/arch, RAM/swap/disk, which ports
(80/443/3000) are already held and by what, existing nginx/systemd/docker
surface, firewall state, Node presence, and whether the DEPLOY.md §0
directories already exist. It installs nothing and changes nothing. Fix
whatever it flags (missing Node 22, occupied port 80, `sites-enabled/default`
conflict, thin swap for the build) **before** running the install commands
below, and keep your SSH session alive before enabling ufw.

### 1b. Install

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git nginx

# Node 22 (engines.node is 22.x; firebase-admin requires it)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # expect v22.x

# Deploy user + directory skeleton
sudo useradd -m -s /bin/bash relu
sudo mkdir -p /opt/relu-website/releases /etc/relu-website
sudo chown -R relu:relu /opt/relu-website
sudo chmod 700 /etc/relu-website

# ssh/http only for nginx; the node server binds 127.0.0.1 (not exposed)
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Clone the repo (read-only fetch URL or deploy key, whatever you use):

```bash
sudo -u relu git clone git@github.com:<org>/relu-website.git /opt/relu-website/repo
```

## 2. Build-time env vars (PUBLIC values)

`next build` inlines every `NEXT_PUBLIC_FIREBASE_*` value into the client
bundle, so the vars must be in the build shell's environment. They are
put there by sourcing a file that matches the repo's `.env*.local` ignore
rule so it can never be committed:

```bash
# create /opt/relu-website/repo/.env.production.local, filled in with the
# LIVE project (relu-480416) values from Firebase console → Project settings
template: deploy/vps/env/build.env.example
chmod 600 /opt/relu-website/repo/.env.production.local
```

`build-and-deploy.sh` sources it around `npm run build` with
`set -a`/`set +a`. Nothing secret is in that file by design — the Firebase
web config is public (it ships to every browser anyway).

## 3. Runtime secrets (NEVER in git, never in the build output)

`FIREBASE_ADMIN_KEY`, `EMAIL_USER`, `EMAIL_PASS` are runtime-only. The build
never sees them; only the node process does, via systemd:

```bash
# On your own machine: encode the service-account JSON as ONE base64 line
base64 -w0 relu-firebase-admin.json        # Git Bash on Windows
base64 -i relu-firebase-admin.json | tr -d '\n'   # macOS

# On the VPS: create the root-owned env file (template:
# deploy/vps/env/runtime.env.example — read its HOW TO CREATE block first)
sudo install -m 600 /dev/stdin /etc/relu-website/runtime.env <<'EOF'
FIREBASE_ADMIN_KEY=<one-line base64>
EMAIL_USER=<club gmail address>
EMAIL_PASS=<gmail app password>
EOF
```

Properties of this approach:

- File is `root:root 0600` — unreadable by the `relu` user, readable by
  systemd which opens it as root before dropping privileges.
- Never copied into `/opt/relu-website/repo`, `.next/`, or any release dir;
  a release contains no secret, so a leak of the deployment dir leaks none.
- Rotation = rewrite the file, `sudo systemctl reset-failed relu-website;
  sudo systemctl restart relu-website` — no rebuild.
- The admin-sdk falls back to default credentials only if the var is unset;
  with the env file present it is always set, so the VPS never needs a gcloud
  ADC session.
- `runtime.env` is *not* a shell script: KEY=VALUE lines, no quotes, no
  multiline values (base64-of-JSON is a single line — that's why the repo
  already uses that encoding).

Sanity check without printing the value:

```bash
sudo bash -c 'source /etc/relu-website/runtime.env &&
  echo "$FIREBASE_ADMIN_KEY" | base64 -d | python3 -c "import json,sys; print(json.load(sys.stdin)[\"project_id\"])"'
```

## 4. nginx

```bash
sudo cp /opt/relu-website/repo/deploy/vps/nginx/cloudflare-ips.conf /etc/nginx/conf.d/cloudflare-ips.conf
sudo cp /opt/relu-website/repo/deploy/vps/nginx/proxy_params_relu.conf /etc/nginx/snippets/proxy_params_relu.conf
sudo cp /opt/relu-website/repo/deploy/vps/nginx/relu-website.conf /etc/nginx/sites-available/relu-website.conf
sudo ln -sf /etc/nginx/sites-available/relu-website.conf /etc/nginx/sites-enabled/relu-website.conf
sudo rm -f /etc/nginx/sites-enabled/default    # port 80 default_server conflict
sudo nginx -t && sudo systemctl reload nginx
```

What the config guarantees:

- `/_next/static/**` served straight from
  `/opt/relu-website/current/standalone/.next/static/` with correct MIME
  types (`include /etc/nginx/mime.types`) + immutable 1y cache — the app's
  hashed chunks never 404 as text/plain.
- `public/**` (avatars, images) served from the release's `public/` dir with
  correct types; everything else is proxied to `127.0.0.1:3000`.
- Origin listens plain HTTP: Cloudflare terminates TLS at its edge
  (Phase 2). Until then the site is also reachable on the IP over http.
- `conf.d/cloudflare-ips.conf` makes nginx trust `CF-Connecting-IP` only
  from Cloudflare ranges, so app logs/rate-limits see real visitor IPs.
- `X-Forwarded-Proto` passes through what Cloudflare reported (https) and
  falls back to `$scheme` for direct pre-DNS hits.
- Readiness URL: `GET /api/health` — proxied, so a 200 proves nginx AND the
  node server are both alive.

## 5. systemd supervision

```bash
sudo install -m 644 /opt/relu-website/repo/deploy/vps/systemd/relu-website.service \
    /etc/systemd/system/relu-website.service

# allow the deploy user to restart the service without full sudo
sudo sh -c 'echo "relu ALL=(root) NOPASSWD: /usr/bin/systemctl restart relu-website.service, /usr/bin/systemctl reset-failed relu-website.service" > /etc/sudoers.d/relu-website'
sudo chmod 440 /etc/sudoers.d/relu-website

sudo systemctl daemon-reload
sudo systemctl enable --now relu-website.service
```

Supervision model:

- **Auto-restart**: `Restart=always`, 2s delay; a `StartLimitBurst` of 10 in
  120s stops an endless crash-loop while still leaving the unit visibly
  "failed" so monitors alert.
- **Readiness**: `ExecStartPost` polls `/api/health` for up to 60s. The unit
  only enters active state once the node server is actually answering, so
  "systemctl is-active" is a deploy-accurate signal, not a process-alive lie.
- **Logs**: stdout/stderr → journald. `journalctl -u relu-website -f` for
  live, `--since "1 hour ago"` to audit a deploy. No extra log service.
- **Watchdog option (optional)**: an external monitor (uptime service,
  Cloudflare health checks — free — or cron + curl from another box) polls
  `https://…/api/health` and alerts on non-200. That is the only monitoring
  this setup needs.

## 6. Deploy / update

```bash
# first time: fill in /opt/relu-website/repo/.env.production.local (§2)
bash /opt/relu-website/repo/deploy/vps/scripts/build-and-deploy.sh
```

The script: pulls code → `npm ci` → `next build` with sourced build vars →
assembles a new release dir (`standalone/. + .next/static` + full repo
`public/` replacing the partial copy Next itself puts in standalone) →
symlink-flips `current` → restarts systemd → runs `verify.sh`. A release dir
is immutable; the running server never sees a half-written build.

Note the public/ replacement: modern Next.js embeds a *partial* `public/`
in `.next/standalone` (file-traced; in this repo it only captured `avatars/`,
which made `public/images` 404 when the docs-style `cp -r public
$STAGE/public` was used — it nested instead of merging). `build-and-deploy.sh`
deletes the standalone copy and re-copies the whole repo `public/`.

Rollback:

```bash
bash /opt/relu-website/repo/deploy/vps/scripts/rollback.sh
```

Firestore/Storage rules still deploy with the firebase CLI, unchanged from
the Cloud Run flow (`firebase deploy --only firestore:rules,storage`).

## 7. Verification (real HTTP, pre-DNS and post-DNS)

After every deploy, run on the VPS:

```bash
HOST=<your.future-domain> \
  PUBLIC_ASSET=/avatars/<one-existing-avatar-file> \
  bash deploy/vps/scripts/verify.sh
```

`verify.sh` checks, with actual signatures:

1. `/api/health` → 200 `application/json` containing `"status":"ok"`.
2. `/` → 200 `text/html` and the body is a real queryable Next.js page.
3. The **first `/_next/static` asset referenced in the rendered homepage
   HTML** is fetched from the same origin; expects 200 and the correct
   javascript/css type, and fails on the classic misconfiguration where a
   chunk comes back as `text/plain`.
4. One file under `public/` (avatars) loads with the right type.

That is exactly the constraint the task cares about: runtime and static
file both reachable from the same origin (nginx) the way the app references
them. Until DNS exists the same script runs against
`BASE=http://127.0.0.1` with the future Host header, so the checks are
identical before and after DNS. Nothing breaks your `BASE` choice later.

You can also point an external browser at `http://<VPS-IP>` to click around
public pages before any DNS work.

## 8. Phase 2 — domain + Cloudflare

Built-in open decision: **DNS + Cloudflare were NOT ready yet** — so the
whole checklist above must pass on the VPS IP/loopback first. When the
domain is ready:

1. Add an A record `relu.org.co → <VPS-IP>` in Cloudflare, **proxy (orange
   cloud) enabled**.
2. In nginx change `server_name _;` to the real hostname
   (deploy/vps/nginx/relu-website.conf documents the line), `nginx -t`,
   reload.
3. SSL/TLS mode: create a **Cloudflare Origin Certificate**, install it at
   `/etc/ssl/certs/relu-website-origin.pem` + key in
   `/etc/ssl/private/…`, un-comment the `listen 443 ssl` block in
   relu-website.conf (it is already written), reload nginx, set Cloudflare
   SSL/TLS mode to **Full (strict)**.
4. Re-run verify: `BASE=https://the.domain ./verify.sh`. Also sanity-check
   with `curl -sSI https://the.domain / | head` that the content-type of the
   homepage is still text/html through the CF edge.
5. Firebase: add the production domain to Firebase Authentication →
   Authorized domains, so Sign-in popup flows work on it.

## 9. What was deliberately NOT chosen (and why)

- **Docker/Compose on the VPS** — the Cloud Run container already exists as
  the artifact of last resort; running it on a single box adds a daemon
  layer with no supervisory benefit over systemd.
- **Log shipping / APM** — journald + one uptime check on /api/health is
  sufficient for a single box; adding Loki/Grafana/Vercel-style tooling is
  YAGNI.
- **HTTP→HTTPS redirect locally** — TLS terminates at Cloudflare; the
  origin's job is plain HTTP behind the edge.
- **Blue/green with two systemd instances** — symlink-flip + restart is
  atomic enough for one box; true zero-downtime would need an HA proxy tier
  the task doesn't ask for.
