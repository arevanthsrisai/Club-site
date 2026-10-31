# ReLU Club Website

Website and admin portal for ReLU (Refining Logic and Unleashing AI), the AI/ML and DSA student club at Amrita Vishwa Vidhyapeetham, Amaravathi.

Students sign up with their college email, register for events (solo or as a team), check in at events and give feedback. Club admins run events, attendance, the gallery, resources, alumni and the team list from `/admin`. Auth is Firebase Authentication; data lives in Firestore, and **media lives in Backblaze B2** (a `reluwebsite` bucket) — served back through the app's server-side media route. Firebase Storage is only kept as the legacy read/delete path for pre-migration objects.

- **Stack**: Next.js 16 (App Router, `output: "standalone"`), TypeScript, React 19, Tailwind CSS, Firebase (Auth / Firestore), Backblaze B2 (S3-compatible), FFmpeg (video pipeline).
- **Runtime**: Node.js 22. Package manager: npm (committed `package-lock.json`). FFmpeg + ffprobe must be on the server `PATH` for the gallery video pipeline (they are installed alongside the app on the VPS kit; on Windows install a full `gyan.dev` build or similar).
- **Deploy targets**: a single Ubuntu VPS with nginx + Cloudflare (the primary target, see [deploy/vps/DEPLOY.md](deploy/vps/DEPLOY.md)), and Cloud Run via the kept-alive `Dockerfile` / `cloudbuild.yaml` artifacts.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000 (port may differ on your machine; printed at startup)
```

`.env.local` is ignored by git and must never be committed.

### Working with staging

There are two Firebase projects:

- `relu-480416`: the live site with real student data.
- `relu-staging`: test data only. The staging deployment (and every preview) uses it, and so should local development.

Each person runs under their own Google account; nobody shares a key file. Access is granted and removed in the Firebase console (Viewer to look around, Editor to develop) — only on **relu-staging**, never the live project.

1. Sign in once so the server code can use your own credentials:

   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project relu-staging
   ```

2. Put the relu-staging web config (Public, Project settings → General → Your apps) into `.env.local`. Leave `FIREBASE_ADMIN_KEY` empty so your own login is used, and `EMAIL_USER`/`EMAIL_PASS` empty so local runs never send mail.

3. `npm run dev` and sign in with a staging test account or a new signup.

## Environment variables

All names are listed in [.env.example](.env.example) with placeholder values only.

| Variable | Kind | Used |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Public web config, **build-time** | Firebase web SDK in `src/lib/firebase.ts` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Public web config, build-time | Firebase web SDK, and the CSP `frame-src` in `src/proxy.ts` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Public web config, build-time | Firebase web SDK; server fallback in `src/lib/firebaseAdmin.ts` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Public web config, build-time | Storage uploads |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Public web config, build-time | Firebase web SDK |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Public web config, build-time | Firebase web SDK |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | Public, build-time, **optional** | Google Analytics, only when GA is linked to the Firebase project; empty = Analytics skipped cleanly |
| `FIREBASE_ADMIN_KEY` | **Runtime secret** | Firebase Admin SDK in `src/lib/firebaseAdmin.ts`: base64-encoded service-account JSON, single line |
| `EMAIL_USER` | **Runtime secret** | Gmail account for `/api/send-email` (Nodemailer) |
| `EMAIL_PASS` | **Runtime secret** | Gmail app password for the same account |
| `B2_S3_ENDPOINT` | **Runtime secret** | Backblaze B2 S3-compatible endpoint for the `reluwebsite` bucket (e.g. `https://s3.eu-central-003.backblazeb2.com`) |
| `B2_REGION` | **Runtime secret** | e.g. `eu-central-003` |
| `B2_BUCKET_NAME` | **Runtime secret** | `reluwebsite` |
| `B2_APPLICATION_KEY_ID` | **Runtime secret** | B2 S3 key ID scoped to the bucket |
| `B2_APPLICATION_KEY` | **Runtime secret** | the corresponding key |
| `R2_*` (legacy) | Runtime optional | Legacy Cloudflare-R2 fallback retained only until `scripts/migrate-firebase-to-b2.mjs` completes the move; remove after migration and delete `src/lib/r2.ts` |

**Media storage model**: uploads go through `/api/media/upload` and `/api/gallery/upload` into approved B2 namespaces (`gallery`, `profiles`, `team_profiles`, `event-images`, `event-covers`, `resources`, `resource-thumbnails`, `avatars`). Delivery is server-side from `/api/gallery/media?key=…` (supports HTTP Range so video scrubbing works). When B2 is not configured the upload UIs fail closed with the list of missing variables — **there is intentionally no silent fallback to Firebase Storage.**

**Firebase → B2 migration** (idempotent, resumable, never deletes originals):

```bash
node scripts/migrate-firebase-to-b2.mjs --dry-run   # preview what would be copied
node scripts/migrate-firebase-to-b2.mjs --execute   # copy objects to B2 (verifies each object, resumable via scripts/.migrate-fb-b2-state.json)
node scripts/migrate-firebase-to-b2.mjs --fix-refs  # rewrite Firestore photoURL/gallery keys to /api/gallery/media?key=… (only after verified copies)
```

Notes:

- The six `NEXT_PUBLIC_FIREBASE_*` values are baked in by `next build` — they must exist in the build shell's environment. They are public by design (Firebase web keys ship to every browser).
- `FIREBASE_ADMIN_KEY`, `EMAIL_USER`, `EMAIL_PASS` are used only at runtime and must never be committed, printed, or inlined into client code. Locally they live in `.env.local`; on the VPS in the root-owned `/etc/relu-website/runtime.env`.
- When `FIREBASE_ADMIN_KEY` is unset (e.g. Cloud Run with default credentials, or your local gcloud login), the Admin SDK falls back to Application Default Credentials.

## Checks

```bash
npm run lint          # eslint
npx tsc --noEmit      # typecheck
npm run build         # production build (standalone output)
npm run test:unit     # unit tests
node --test tests/    # all node test suites (or run a single tests/*.mjs|js file)
node --test tests/b2-permanent-delete-live.test.mjs   # live B2 round-trip; requires real B2 keys
npm run test:rules    # Firestore/Storage security rules against local emulators
```

`test:rules` needs Java (see the emulator job in [ci.yml](.github/workflows/ci.yml)); it downloads the Firebase emulators on first run. CI runs lint + typecheck + build and the rules tests on every PR.

## Production standalone server

`next.config.mjs` sets `output: "standalone"`. Run **`node .next/standalone/server.js`** — plain `next start` does not support standalone and Next.js warns instead of serving correctly. A production run needs the assembled layout:

```
release dir/
  server.js            from .next/standalone
  node_modules/…       traced dependencies (inside the standalone copy)
  .next/static/        client chunks copied from .next/static
  public/              copied from repo public/ (replaces the partial copy
                       Next 16 puts inside .next/standalone)
```

Environment for the process: `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=127.0.0.1` behind nginx. Readiness endpoint: `GET /api/health` → `200 {"status":"ok", …}` with the correct content type, touching no Firebase/email state.

[deploy/vps/scripts/build-and-deploy.sh](deploy/vps/scripts/build-and-deploy.sh) does all of this on a real box; [deploy/vps/scripts/verify.sh](deploy/vps/scripts/verify.sh) proves the result over HTTP.

## Project layout

```
src/
  app/
    (public)/     public site: home, about, events, resources, alumni, contact, profile, auth, privacy, terms
    admin/        admin portal (protected; unauthenticated users are sent to /admin/login)
    api/          server routes (see below)
  components/     UI, grouped into admin/, layout/, public/ and ui/
  services/       Firestore and Storage access, one file per area
  lib/            Firebase setup, auth helpers, the @/lib/api entry point, small utilities
  types/          shared TypeScript types
public/
  avatars/        preset avatars, one folder per style (counted by /api/avatars)
  images/         logos, founder photos (images/founders), placeholders
deploy/vps/       Ubuntu VPS deployment kit + checklist
docs/ARCHITECTURE.md  roles, data model, events, registrations, storage
```

Pages import data functions from `@/lib/api`, which re-exports every service and the shared types.

## API routes

| Route | Purpose |
|---|---|
| `/api/health` | Readiness check for monitors; no side effects |
| `/api/registrations` | Every student action on registrations, teams, check-in, feedback; verifies the caller's Firebase ID token |
| `/api/send-email` | CTO-only mail for admin approvals/rejections (Gmail app-password login, domain allow-list) |
| `/api/media/upload` | Admin media upload to B2 (all approved namespaces; verifies Firebase ID token + `gallery.manage` permission via the shared serverAuthz layer; sniffs file magic bytes against the declared MIME; enforces per-category size limits) |
| `/api/gallery/upload` | Gallery upload with the video pipeline: FFmpeg H.264/AAC normalization (≤720p), poster thumbnail generation, original preserved via the `-orig` key suffix, `processingStatus` on the gallery doc |
| `/api/gallery/media` | Server-side delivery of stored media from B2 for all approved namespaces, with HTTP Range support; validates every key against the safe key schemas |
| `/api/gallery/delete` | Admin gallery deletion; also cleans up the associated thumbnail and `-orig` original when present |
| `/api/admin/nicknames` | CTO-only team-nickname management (`admins/{uid}.nickname`); unique, audited via `logServerActivity` |
| `/api/admin/students` | Registered-students directory behind `/admin/students` |
| `/api/admin/delete-user` | CTO-only Firebase Auth account deletion |
| `/api/avatars` | Lists `public/avatars` categories as URL paths |

Admin authorization is centralized in `src/lib/serverAuthz.ts`: every management route authenticates the Firebase ID token, reads the admin's current role from Firestore, resolves permissions from the shared role catalog (CTO always has everything), and answers 401/403 consistently. Failing role documents fail closed.

Security rules for Firestore and Storage live in `firestore.rules` and `storage.rules`; test changes with `npm run test:rules`, then deploy with the Firebase CLI (see below).

## Deployment (Ubuntu VPS)

The detailed, ordered checklist is in **[deploy/vps/DEPLOY.md](deploy/vps/DEPLOY.md)** — start there. Summary:

1. **Preflight**: `deploy/vps/scripts/preflight.sh` on the box first — read-only inventory of OS, ports, services, firewall, Node; fix what it flags.
2. **Prerequisites**: Ubuntu 22.04/24.04, Node 22 (NodeSource), nginx, git; non-root `relu` deploy user; firewall allows 80/443/SSH only.
3. **Build-time config**: only the public `NEXT_PUBLIC_FIREBASE_*` values, in `/opt/relu-website/repo/.env.production.local` (matches the `.env*.local` git-ignore rule, so it cannot be committed).
4. **Runtime secrets**: `FIREBASE_ADMIN_KEY` (base64 service-account JSON), `EMAIL_USER`, `EMAIL_PASS` in `/etc/relu-website/runtime.env`, `root:root 0600`, fed to systemd via `EnvironmentFile=`.
5. **Process supervision**: [relu-website.service](deploy/vps/systemd/relu-website.service) — `Restart=always`, journald logs (`journalctl -u relu-website -f`), readiness gated on `/api/health`.
6. **nginx**: serves `/_next/static` and `public/` with correct MIME types, proxies the rest to `127.0.0.1:3000`, trusts `CF-Connecting-IP` only from Cloudflare ranges.
7. **Deploy / rollback**: `build-and-deploy.sh` (build → assemble → atomic symlink flip → restart → verify) and `rollback.sh`.
8. **Verification**: `verify.sh` runs before DNS exists (against `http://127.0.0.1` with the future `Host` header) and again through the live domain — homepage 200 `text/html`, a real `/_next/static` chunk with the right MIME type, a `public/` file, and `/api/health`.
9. **Cloudflare + DNS** (Phase 2): proxied A record, real `server_name`, optional Cloudflare Origin Certificate listener, SSL mode **Full (strict)**, then re-run `verify.sh` with `BASE=https://…`. Verified on the VPS IP first, DNS switched afterwards.

The `Dockerfile` and `cloudbuild.yaml` remain the existing Cloud Run deployment path, and it is **automatic**: every push to `main` deploys the site. The Cloud Build trigger `deploy-main` (region `us-central1`, project `relu-480416`) runs `cloudbuild.yaml`, which builds the image and deploys it to Cloud Run. Since `main` only changes through approved pull requests, merging a PR *is* the deploy; progress and logs are under Cloud Build → History in the Google Cloud console. The trigger holds the `NEXT_PUBLIC_FIREBASE_*` values for the live project and `EMAIL_USER` as substitutions; the Gmail app password is read by Cloud Run from the `email-pass` secret in Secret Manager. Roll back for that path via Cloud Run → Revisions. None of this is used by the VPS runtime. Security rules are not part of either build — deploy them separately with the Firebase CLI, and when a change touches both the app and the rules, deploy/merge the app first and the rules second.

## Troubleshooting

- **Images 404** — `public/` must be copied *whole* over the partial `public/` that Next 16 embeds in `.next/standalone`, and `.next/static` must be copied into `.next/standalone/.next/static` (without it, dev/prod runs show an eternal loading state for dynamic routes because chunk/MIME loads fail locally). `build-and-deploy.sh` does both correctly ([build-and-deploy.sh](deploy/vps/scripts/build-and-deploy.sh)), and `verify.sh` catches the symptom.
- **Upload UI lists missing `B2_*` variables** — expected fail-closed behavior; configure the B2 app keys (see table above). With keys absent, the app deliberately refuses to fall back to Firebase Storage.
- **Gallery video uploads skip compression** — FFmpeg/ffprobe are missing from the server `PATH`; the upload still succeeds and the doc records `processingStatus: "partial"`.
- **JS/CSS served as `text/plain`** — nginx must `include /etc/nginx/mime.types` for the static locations (`deploy/vps/nginx/relu-website.conf` does); `verify.sh` fails loudly on this.
- **`/api/health` failing after deploy** — `journalctl -u relu-website -f`; usually missing env values in `runtime.env`, or the release build didn't inline the Firebase web config (check that the build env file was sourced).
- **Build asks about Firebase config** — the `NEXT_PUBLIC_FIREBASE_*` values were absent from the build shell; check `.env.production.local` exists and is sourced by the script.
- **404 requests to `googletagmanager.com` in the console** — Google Analytics is not linked to the Firebase project; leave `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` empty and Analytics is skipped cleanly.
- **404 on a page after a direct link/refresh** — nested routes are dynamic; check the server log for the specific route error before suspecting assets.

## Security notes

- Real values never go into any tracked file: `.env*.local` and `/etc/relu-website/*` are excluded from the repo on purpose, and [.env.example](.env.example) holds placeholders only.
- Rotate the Firebase Admin credential from Firebase console → Project settings → Service accounts (encode the new JSON as base64, rewrite `runtime.env`, restart the service); rotate the Gmail app password in the Google account and update `runtime.env`.
- Keep admin membership tight in the Firebase console, and prefer least-privilege roles on artifacts that can push deploys.
- The CSP (with per-request nonce) lives in [src/proxy.ts](src/proxy.ts); adjust allow-lists there, not by disabling protections.
- B2 keys let a caller read the whole bucket — create a key scoped to `reluwebsite` only and rotate it like any secret (Backblaze → App Keys → revoke + recreate, then update `runtime.env`/`.env.local`).
