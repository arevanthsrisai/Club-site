# Architecture

How the ReLU website is put together, for whoever maintains it next.

## Overview

- Next.js 16 App Router app in `src/app`, written in TypeScript and styled with Tailwind.
- Firebase is the backend: Auth for accounts, Firestore for data, Storage for images and PDFs, Analytics for page views.
- Most reads happen in the browser through the Firebase web SDK, guarded by `firestore.rules`.
- Writes that need checks the rules can't express go through API routes in `src/app/api`. These use the Firebase Admin SDK and verify the caller's ID token first (`src/lib/serverAuth.ts`).
- The app runs as a standalone Next.js server in a Docker container on Cloud Run.

## Users and roles

There are two kinds of account. Both use Firebase Auth.

**Students** sign up at `/auth/signup` with an `@av.students.amrita.edu` address and must verify their email before logging in. Their profile (name, roll number, class, section, mobile, avatar) lives in `users/{uid}`. They have to complete it before registering for events. Student accounts expire three years after creation: on the next login the profile is deleted and they are signed out.

**Admins** sign up at `/admin/signup`. This creates `admins/{uid}` with role `pending` and a matching `pending_registrations/{uid}` request. The CTO approves or rejects the request under Manage Admins, and the applicant gets an email either way. Approved admins start as `Activator` with status `onboarding`, fill in their profile on `/admin/onboarding`, and then become `active`.

Club roles (President, Vice Presidents, Treasurer and so on) are stored in the `club_roles` collection. The CTO adds, renames, reorders and removes them under Manage Admins → Club Roles. Each role has a label, an order for the team pages and a seat limit. A role can only be deleted once nobody holds it. Two roles are fixed in code (`src/lib/roles.ts`): **CTO**, and **Activator**, the unlimited default every approved admin starts with. The defaults in that file are stored the first time the CTO opens Manage Admins, and are used until then.

When the CTO gives someone a role whose seats are all taken, Manage Admins asks who to replace. The replaced member moves back to Activator in the same step.

- **Only the CTO** can change roles, approve admins, remove admins and use the Doomsday console.
- **Any admin** can manage events, gallery, resources, alumni, messages and settings.
- **Tenure:** admin access expires two years after approval. The CTO is exempt.
- **Handover:** the CTO can pass the role on from the Doomsday console. The outgoing CTO becomes a Mentor.

## Data model (Firestore)

| Collection | Contents | Who can read |
|---|---|---|
| `users` | Student profiles | The student, admins |
| `admins` | Admin profiles and roles | The admin themself, other admins |
| `pending_registrations` | Admin sign-up requests | Admins |
| `events` | Event details and lifecycle flags | Everyone |
| `event_secrets` | Attendance code for each event (`code`, `failures`) | Admins |
| `registrations` | One doc per individual or team, id `{eventId}_{leaderUid}` | Students on that registration, admins |
| `invitations` | Team invites and join requests | Signed-in users |
| `feedbacks` | Event feedback | The author, admins |
| `gallery`, `resources`, `alumni` | Public content | Everyone |
| `messages` | Contact form submissions | Admins (anyone can create) |
| `audit_logs` | Admin actions; only the latest 30 are kept | Admins |
| `club_roles` | Role labels, order and seat limits | Everyone (CTO writes) |
| `settings` | Class and section lists for the profile form | Signed-in users |

Every collection except `messages` can only be written by admins from the browser. Students change their own `users` doc directly; everything else they do goes through `/api/registrations`.

The About page lists the team by reading `admins` on the server and passing on only public fields (name, role, photo, social links, email).

## Events

Each event moves through flags that admins control from the Forms page (`/admin/forms`):

- `registrationStatus`: `upcoming`, then `open`, then `closed`.
- `status`: `upcoming`, then `ongoing` once the admin starts the event, then `past`.
- `attendanceStatus`: `active` while check-in is open. Starting attendance generates a 4-digit code and stores it in `event_secrets/{eventId}`. The public event doc only says that attendance is open.
- `feedbackStatus`: `active` while feedback is open.

`minTeamSize` and `maxTeamSize` decide whether an event is solo (`maxTeamSize` of 1) or a team event.

## Student actions (`/api/registrations`)

`src/app/api/registrations/route.ts` handles every student action that touches registrations, invitations or feedback. The browser calls it through `callRegistrationsApi` in `src/services/registrations.ts`. Each request carries the user's Firebase ID token, and the route always acts as that user.

- **register**: creates the registration from the student's saved profile. Team events also need a unique team name.
- **searchStudents**: finds students by name or roll number so a leader can invite them. Returns only name, roll number and photo.
- **invite / respond / requestJoin / availableTeams**: team building. A leader invites students, or students ask to join an existing team. The person the invite or request is addressed to accepts or rejects it. Teams below `minTeamSize` stay in `forming` status.
- **removeMember / deleteTeam**: a member can leave; the leader can remove members or disband the team.
- **checkin**: compares the code with `event_secrets`. After five wrong codes the student is locked out until an admin restarts attendance, which also issues a new code.
- **feedback**: allowed once per student, only for those who checked in, and only while feedback is open. It also updates the event's `avgRating` and `feedbackCount`.

## Other server routes

- `/api/send-email`: sends approval and rejection mail through Gmail (Nodemailer). CTO only, and only to allowed domains.
- `/api/admin/delete-user`: deletes a Firebase Auth account. CTO only.
- `/api/avatars`: lists the preset avatar images in `public/avatars`.

## Storage

Uploads go to these folders: `events/`, `event-images/`, `gallery/`, `resources/`, `resource-thumbnails/`, `profiles/` and `team_profiles/`. Only admins can write them (`storage.rules` checks that the uploader has an `admins` doc with a role other than `pending`). Students can only write their own `avatars/{uid}/` folder. Everything is publicly readable.

## Configuration

Environment variables are listed in `.env.example`:

- `NEXT_PUBLIC_FIREBASE_*`: web app config, baked in at build time.
- `FIREBASE_ADMIN_KEY`: base64 service account JSON for the Admin SDK. On Cloud Run it is left empty and the service account's default credentials are used. That account needs Firestore and Firebase Auth access.
- `EMAIL_USER`, `EMAIL_PASS`: Gmail account and app password for `/api/send-email`. On Cloud Run, `EMAIL_PASS` comes from the `email-pass` secret in Secret Manager.
