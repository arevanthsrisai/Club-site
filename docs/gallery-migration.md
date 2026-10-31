# Gallery storage migration: Cloudflare R2 → Backblaze B2

The gallery's server-side storage moved to a provider abstraction in
[r2 → objectStorage@../..](...see `src/lib/objectStorage.ts`). B2 is the
primary provider once its environment variables are set; legacy Cloudflare R2
remains working only while existing objects are migrated. Nothing in this
repository rewrites, deletes, or bulk-relabels existing data.

## 1. Configure B2 (owner steps)

1. In the Backblaze B2 console open the `reluwebsite` bucket's **Details** and
   copy the **S3 endpoint** (format `https://s3.<region>.backblazeb2.com`) and
   the **region** (the `<region>` part). Do not guess these.
2. Create/use an application key limited to this bucket ("relu"). Never share
   the secret in chat, commits, or client code.
3. Set real `.env.local` values (never `.env.example`, never `.env*.comitted`):

   ```
   B2_S3_ENDPOINT=https://s3.<region>.backblazeb2.com
   B2_REGION=<region>
   B2_BUCKET_NAME=reluwebsite
   B2_APPLICATION_KEY_ID=<application key id>
   B2_APPLICATION_KEY=<secret>
   ```

## 2. How delivery works on a private bucket

- The bucket is private; raw B2 object URLs are not publicly readable and must
  not be stored in Firestore.
- New uploads return a same-origin URL: `/api/gallery/media?key=gallery/<eventId>/...`.
- `src/app/api/gallery/media/route.ts` validates the key, reads the object with
  the server-side S3 client, and streams it with
  `Cache-Control: public, max-age=31536000, immutable` (safe because keys are
  uuid-unique), correct `Content-Type` (magic-sniffed server-side at upload),
  `X-Content-Type-Options: nosniff`, and `Content-Disposition: inline`.
- Legacy items (Firebase Storage or R2 `r2.dev` URLs) keep working unchanged —
  their stored URLs are untouched.

## 3. Migrating existing R2 objects (once, after B2 is configured)

Run `node scripts/migrate-gallery-to-b2.mjs` with the legacy `R2_*` variables
and the new `B2_*` variables in the environment at once. The script:

1. Lists every existing R2 object under the `gallery/` prefix (read-only
   inventory first).
2. Copies each object to B2 under the **same inventory-checked key**, with the
   same content type and cache headers (Copy/Get+Put; originals in R2 are
   never modified or deleted).
3. **Verifies** each copy by HEAD-ing B2 for matching size and head-checking
   delivery through `/api/gallery/media` before it is considered migrated.

- Objects already migrated are skipped on re-run (idempotent).
- The script never deletes R2 objects: cleanup is a separate, explicit,
  manual decision after a full verification pass.
- Firestore metadata is **not rewritten** by this migration: keys stay valid
  after the copy because the same key is used, and the media route fetches
  whatever provider is configured. Items whose stored URL already points at
  `r2.dev` keep their absolute URL and continue to work while R2 remains
  reachable; migrating those to the media route is an optional later step.

## 4. After verification

1. Confirm every gallery item renders through the new delivery and a
   spot-check image's bytes match the R2 original (hash compare).
2. Remove the legacy `R2_*` variables from `.env.local` / deployment config.
3. The status route (`/api/gallery/status`) will then report
   `provider: "b2"` for the admin gallery UI; the Firebase Storage fallback
   stays in place for environments with neither provider configured.

## 5. Rollback

B2 and R2 providers are independent: re-setting the five `R2_*` variables
restores legacy behavior (keys and URLs are unchanged), so a rollback only
requires configuration, not data surgery.
