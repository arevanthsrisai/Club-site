# UI/UX Full-Site Audit Checklist

Statuses: `NOT STARTED` / `IN PROGRESS` / `VERIFIED` / `BLOCKED`
Baseline commit at audit start: `38fb0fa`. Prior relevant commits: `a025fca` (admin polish + route loading states), `38fb0fa` (public fixes).

## Route inventory

| Route | Type | Loading state | Status |
| --- | --- | --- | --- |
| `/` | Public home (client CTA) | app-level `loading.tsx` + `template.tsx` slide-up | VERIFIED |
| `/about` | Public team (server) | app-level loading | VERIFIED |
| `/events` | Public events list + search | app-level loading | VERIFIED |
| `/events/[id]` | Public event detail (client subs) | app-level loading + in-page spinner/not-found states | VERIFIED |
| `/resources` | Public resources (server) | app-level loading | VERIFIED |
| `/alumni` | Public alumni (server) | app-level loading | VERIFIED |
| `/contact` | Public contact form | app-level loading | VERIFIED |
| `/terms`, `/privacy` | Public legal | app-level loading | VERIFIED |
| `/profile` | Student profile (auth) | app-level loading + page Suspense + spinner | VERIFIED |
| `/auth/login`, `/auth/signup`, `/auth/verify-email` | Student auth | app-level loading | VERIFIED |
| `/admin` | Admin dashboard (all roles) | `loading.tsx` | VERIFIED |
| `/admin/events`, `/events/new`, `/events/[id]`, `/events/[id]/registrations` | Admin events | `loading.tsx` per route | VERIFIED |
| `/admin/forms`, `/admin/forms/registrations` | Admin forms/registrations | `loading.tsx` (forms only) | VERIFIED |
| `/admin/gallery`, `/admin/gallery/[eventId]` | Admin gallery | `loading.tsx` per route | VERIFIED |
| `/admin/resources`, `/admin/messages`, `/admin/alumni`, `/admin/team`, `/admin/admins` | Admin collections | `loading.tsx` | VERIFIED |
| `/admin/doomsday` | CTO-only operations | `loading.tsx` | VERIFIED |
| `/admin/profile`, `/admin/onboarding` | Admin self-service | `loading.tsx` / direct | VERIFIED |
| `/admin/login`, `/admin/signup` | Admin auth | direct render (no gate) | VERIFIED (intentional: no gate before login) |
| `not-found`, `error` | App-wide | — | VERIFIED |

## Role coverage

| Role | Access model | Status |
| --- | --- | --- |
| Guest (not signed in) | Public pages only | VERIFIED |
| Student (`users` collection) | Public + `/profile`, events registration, team invites | VERIFIED |
| Activator (default admin role) | Full admin dashboard | VERIFIED |
| Named roles (President, VP, PR Head, Treasurer, Faculty, Mentor) | Same dashboard, CTO-only sections gated server-side | VERIFIED |
| CTO (single holder) | Admin + Doomsday ops + role management | VERIFIED |

Server-side enforcement via Firestore rules (`tests/rules.test.mjs`) and `serverAuth.ts`; client visibility is never the auth check.

## Component families

- [x] Navbar (desktop + mobile + dropdown) — VERIFIED (38fb0fa / a025fca)
- [x] Footer — VERIFIED (a025fca)
- [x] Sidebar (admin) — VERIFIED (a025fca)
- [x] PageHeader shared primitive — VERIFIED (a025fca)
- [x] Event cards + event detail + modal — VERIFIED (38fb0fa)
- [x] Events search + filters + found-count — VERIFIED (38fb0fa)
- [x] TeamMember / Activator / Founder cards — VERIFIED (38fb0fa heading pass)
- [x] ResourceCard + category tabs — VERIFIED
- [x] Contact form (labels, alerts, maxLength) — VERIFIED (38fb0fa)
- [x] Signup / Login (student) — VERIFIED (38fb0fa)
- [x] Profile editor (student) — VERIFIED (38fb0fa)
- [x] Verify-email — VERIFIED
- [x] NotificationBell — VERIFIED (38fb0fa)
- [x] CheckIn / Feedback / TeamRegistration modals — VERIFIED (inspect-only)
- [x] Toast system — VERIFIED (a025fca)
- [x] CookieConsent — VERIFIED (a025fca)
- [x] Admin login/signup — VERIFIED (labels + alerts)
- [x] Admin onboarding — VERIFIED (labels + upload progress)
- [x] Admin login/signup/onboarding labels — VERIFIED
- [x] Admin events list stats — VERIFIED (a025fca)
- [x] Admin messages CSV export — VERIFIED (a025fca)
- [x] Community (activators) grid — VERIFIED

## Validation outcomes (this audit)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | PASS (exit 0) |
| `eslint` | PASS (0 problems) |
| `next build` | PASS |
| Production standalone smoke (port 3100) | PASS — all routes 200, CSS `200 text/css` |
| Firestore rules test (`npm run test:rules`) | PASS — 10/10 tests under Firestore + Storage emulators (admin escalation blocked, pending admins restricted, storage admin-only, audit logs/messages) |
| Interaction audit (Home / Events / Profile) | PASS — no nested interactives, no unnamed buttons/links, no misleading cursor-pointer elements; admins page Escape-to-close fixed with document-level keydown; EventForm unreadable dates now surface inline on blur with `aria-invalid`/`role=alert` |
| Forms end-to-end (read-only in browser) | PASS — event selection, search, counts, registration table, Escape-to-close verified against live staging data (read-only; no production mutations) |
| Footer links | PASS — corrected dead `/team` link to `/about` (About is the team roster) |

## Email normalization + duplicate guard (this audit)

| Check | Result |
| --- | --- |
| Shared `normalizeEmail` helper (`src/lib/normalizeEmail.ts`) | PASS — trims + lowercases; null for empty/non-string |
| `src/lib/auth.ts` `signUp()` normalizes + calls `assertEmailNotInUse()` before Auth | PASS |
| `src/services/admin.ts` `createAdminDirectly()` normalizes + duplicate guard + stores normalized email | PASS |
| `src/services/admin.ts` `createPendingRegistration()` stores normalized email | PASS |
| `src/services/admin.ts` `approveRegistration()` normalizes legacy email on fallback path | PASS |
| `src/services/admin.ts` `transferCTORole()` queries by normalized email | PASS |
| `src/services/users.ts` `createUserProfile()` stores normalized email | PASS |
| `src/components/admin/AdminGuard.tsx` `SetupAccount` normalizes `user.email` | PASS |
| `src/app/admin/signup/page.tsx` normalizes before `signUp()` | PASS |
| `src/app/(public)/auth/signup/page.tsx` calls `assertEmailNotInUse()` before Auth | PASS |
| `tests/normalizeEmail.test.mjs` (5 tests, `npm run test:unit`) | PASS — 5/5 |

## On-demand image loading (this audit)

| Check | Result |
| --- | --- |
| Public event gallery images (`src/app/(public)/events/[id]/page.tsx`) | PASS — `loading="lazy"` added; fixed `width={0} height={0}` invalid attrs |
| Event hero `next/image` | PASS — unchanged, already eager (correct for LCP) |
| Public alumni photos (`src/app/(public)/alumni/page.tsx`) | PASS — `loading="lazy" decoding="async"` |
| Admin alumni photos (`src/app/admin/alumni/page.tsx`) | PASS — `loading="lazy" decoding="async"` |
| Admin gallery grid `next/image` | PASS — unchanged, eager is correct (admin tooling, small grid) |
| Event detail videos | PASS — `preload="none"` (was `preload="metadata"`) |
| Admin gallery preview `<img>` / `<video>` | PASS — local object URL only, unchanged |
| ResourceCard / ImageUpload / FileUpload / Sidebar / TeamMember | PASS — unchanged (already lazy or small) |

## Lossless policy + migration script (this audit)

| Check | Result |
| --- | --- |
| `src/lib/objectStorage.ts` `losslesslyOptimize()` | PASS — only PNG/AVIF/TIFF → WebP lossless when smaller; JPEG/video/PDF untouched |
| Server upload route re-validates MIME via magic bytes, not browser type | PASS |
| Private-bucket delivery via `/api/gallery/media` with `X-Content-Type-Options: nosniff` | PASS |
| `scripts/migrate-gallery-to-b2.mjs` exists, is idempotent, never deletes R2 | PASS — listed, copied, size-verified |
| `docs/gallery-migration.md` documents B2 setup + migration + rollback | PASS — unchanged |
| `.env.example` has B2 + R2 placeholders only | PASS — no secrets |

## Known blockers / unresolved

1. **`FIREBASE_ADMIN_KEY` in `.env.local` is corrupt** (40 chars; a valid base64 service-account JSON is ~2,500+). Server-rendered admin reads (About team roster, etc.) catch the error and fall back to empty data. **Remediation:** download a fresh service-account key from the Firebase console, base64-encode it with `node -e "console.log(require('fs').readFileSync('<keyfile>').toString('base64'))"`, and replace the value. Never commit the raw key. (Owner action required — cannot be regenerated from code.)
2. **`R2_*` credentials absent from `.env.local`** — end-to-end R2 upload/delete cannot be exercised. Implementation is complete and safe by design: server-only routes (`/api/gallery/upload|delete|status`), admin-guarded, MIME/size-validated, lossless conversion verified at pixel level (decoded pixels byte-identical; JPEG passthrough untouched). The gallery UI falls back correctly and names the missing keys. Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` to `.env.local` to unblock (see `.env.example`).
3. `package.json` has a duplicated `"build"`/`"start"` script pair (pre-existing, uncommitted local edit; not from this audit). Harmless (last value wins) but should be cleaned up by whoever created that local edit.
4. Forms lifecycle mutations (create/publish/close/delete) were code-reviewed against the data model but not exercised against production data by design; CSV/PDF exports and the registration viewer were verified read-only in the browser.
