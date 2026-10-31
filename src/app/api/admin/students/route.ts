import { studentPatchSchema as patchSchema } from "@/lib/studentFields";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity, ServerAuthContext } from "@/lib/serverAuthz";
import { normalizeEmail } from "@/lib/normalizeEmail";

/**
 * /api/admin/students — Registered Students management API.
 *
 * GET    ?page&pageSize&search&sort&verified → paginated student list
 * PATCH  { uid, data }                       → edit permitted profile fields
 * DELETE ?uid                                → permanently delete a student account
 *
 * Authorization (server-enforced, see lib/serverAuthz.ts):
 * - every request must carry a valid Firebase ID token of an ACTIVE admin;
 * - GET requires students.view, PATCH students.edit, DELETE students.delete.
 * Editing never touches admins/{uid} or club roles — student profile edits can
 * never grant or revoke administrative privileges.
 */

export const dynamic = "force-dynamic";

const MAX_SCAN = 1000; // pagination window: pages are served from this ordered scan

function studentFromDoc(id: string, data: FirebaseFirestore.DocumentData) {
    const createdAt = data.createdAt;
    return {
        uid: id,
        email: typeof data.email === "string" ? data.email : "",
        displayName: typeof data.displayName === "string" ? data.displayName : "",
        rollNo: typeof data.rollNo === "string" ? data.rollNo : "",
        class: typeof data.class === "string" ? data.class : "",
        section: typeof data.section === "string" ? data.section : "",
        mobile: typeof data.mobile === "string" ? data.mobile : "",
        hosteller: data.hosteller === true,
        isVerified: data.isVerified === true,
        photoURL: typeof data.photoURL === "string" ? data.photoURL : "",
        createdAt: createdAt?.toDate ? createdAt.toDate().toISOString() : null,
    };
}

export async function GET(request: Request) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "students.view")) return forbidden("students.view");

    try {
        const db = getAdminFirestore();
        const url = new URL(request.url);
        const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
        const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "12", 10) || 12));
        const search = (url.searchParams.get("search") || "").trim().toLowerCase();
        const verified = url.searchParams.get("verified") || "all"; // all|true|false
        const sort = url.searchParams.get("sort") || "newest"; // newest|oldest|name|email

        const snap = await db.collection("users").limit(MAX_SCAN).get();
        let rows = snap.docs.map(d => studentFromDoc(d.id, d.data()));

        if (verified === "true") rows = rows.filter(r => r.isVerified);
        if (verified === "false") rows = rows.filter(r => !r.isVerified);

        if (search) {
            rows = rows.filter(r =>
                [r.displayName, r.email, r.rollNo, r.class, r.section, r.mobile, r.uid]
                    .some(v => v && v.toLowerCase().includes(search))
            );
        }

        const oldest = sort === "oldest";
        if (sort === "name") rows.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
        else if (sort === "email") rows.sort((a, b) => a.email.localeCompare(b.email));
        else rows.sort((a, b) => {
            const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
            const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
            return oldest ? ta - tb : tb - ta;
        });

        const total = rows.length;
        const pageCount = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, pageCount);
        const start = (safePage - 1) * pageSize;

        return Response.json({
            students: rows.slice(start, start + pageSize),
            total,
            page: safePage,
            pageSize,
            pageCount,
            scanned: snap.size,
            truncated: snap.size >= MAX_SCAN,
            can: {
                edit: ctx.isCTO || ctx.permissions.includes("students.edit"),
                delete: ctx.isCTO || ctx.permissions.includes("students.delete"),
            },
        });
    } catch (err) {
        console.error("[students API] list failed:", err);
        return Response.json({ error: "Failed to load student accounts." }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const update = await patchHandler(request);
    return update;
}

async function patchHandler(request: Request): Promise<Response> {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "students.edit")) return forbidden("students.edit");

    const db = getAdminFirestore();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return Response.json({ error: issue?.message || "Invalid request." }, { status: 400 });
    }
    const { uid, data } = parsed.data;
    const updates = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && !(typeof v === "string" && v === "")));
    if (Object.keys(updates).length === 0) {
        return Response.json({ error: "No changes to save." }, { status: 400 });
    }
    let emailChanged = false;

    const userDoc = db.collection("users").doc(uid);
    const userSnap = await userDoc.get();
    if (!userSnap.exists) {
        return Response.json({ error: "Student account not found." }, { status: 404 });
    }
    const priorAuthEmail = normalizeEmail(typeof userSnap.get("email") === "string" ? String(userSnap.get("email")) : "") ?? "";

    // Uniqueness: roll number (application-level identity, intended unique).
    // Skip when the value is unchanged for this account.
    if (typeof updates.rollNo === "string" && updates.rollNo) {
        const existing = await db.collection("users").where("rollNo", "==", updates.rollNo).limit(2).get();
        if (existing.docs.some(d => d.id !== uid)) {
            return Response.json({ error: `Roll number ${updates.rollNo} is already assigned to another student.` }, { status: 409 });
        }
    }

    // Email changes go through the authenticated Firebase Admin flow so the
    // Authentication record and the Firestore profile never drift apart.
    if (typeof updates.email === "string" && updates.email) {
        const currentEmail = normalizeEmail(typeof userSnap.get("email") === "string" ? userSnap.get("email") : "") ?? "";
        const newEmail = normalizeEmail(updates.email) ?? updates.email;
        if (newEmail !== currentEmail) {
            emailChanged = true;
            try {
                await getAdminAuth().updateUser(uid, { email: newEmail, emailVerified: false });
            } catch (err: any) {
                if (err?.code === "auth/email-already-exists" || err?.code === "auth/invalid-email") {
                    return Response.json({ error: err.code === "auth/invalid-email" ? "Enter a valid email address." : "That email is already in use by another account." }, { status: 409 });
                }
                console.error("[students API] Auth email update failed:", err);
                return Response.json({ error: "Could not update the sign-in email." }, { status: 500 });
            }
        }
    }

    // Firestore profile sync (email included when changed). If the profile
    // write fails after the Auth email was changed, revert the Auth email so
    // the two stores cannot drift apart.
    try {
        await userDoc.set({ ...updates }, { merge: true });
    } catch (err) {
        console.error("[students API] Firestore profile update failed:", err);
        if (emailChanged) {
            try { await getAdminAuth().updateUser(uid, { email: priorAuthEmail }); } catch (revertErr) {
                console.error("[students API] Auth email revert failed:", revertErr);
            }
        }
        return Response.json({ error: emailChanged ? "Could not update the sign-in email — the change was rolled back. Try again." : "Failed to save the profile." }, { status: 500 });
    }

    // Immutable/account identifiers are never editable here; audit records only
    // which fields changed (values omitted to keep personal data out of logs).
    await logServerActivity(ctx.uid, ctx.name, "STUDENT_PROFILE_EDITED", {
        targetUid: uid,
        changedFields: Object.keys(updates),
        ...(emailChanged ? { signInEmailChanged: true } : {}),
    });

    return Response.json({ success: true, updated: Object.keys(updates) });
}

export async function DELETE(request: Request) {
    const ctx: ServerAuthContext | null = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "students.delete")) return forbidden("students.delete");

    try {
        const url = new URL(request.url);
        const uid = url.searchParams.get("uid") || "";
        if (!uid || uid.length > 128) {
            return Response.json({ error: "Missing or invalid uid parameter." }, { status: 400 });
        }
        if (uid === ctx.uid) {
            return Response.json({ error: "You cannot delete your own account." }, { status: 400 });
        }

        const db = getAdminFirestore();
        const userSnap = await db.collection("users").doc(uid).get();
        if (!userSnap.exists) {
            return Response.json({ error: "Student account not found (it may already be deleted)." }, { status: 404 });
        }

        // Safeguard: team admins are managed from Manage Team Access, where role
        // hand-over and revocation have their own confirmations and audit trail.
        const adminSnap = await db.collection("admins").doc(uid).get();
        if (adminSnap.exists) {
            return Response.json({ error: "This person is a team admin. Revoke their access from Manage Team Access instead." }, { status: 409 });
        }

        // Same order as the app's existing deletion flow: Firestore data first,
        // then the Authentication account (best effort, non-fatal).
        const batch = db.batch();
        batch.delete(db.collection("users").doc(uid));
        batch.delete(db.collection("pending_registrations").doc(uid));
        await batch.commit();

        try {
            await getAdminAuth().deleteUser(uid);
        } catch (err: any) {
            if (err?.code !== "auth/user-not-found") {
                console.error("[students API] Auth deletion failed:", err);
            }
        }

        await logServerActivity(ctx.uid, ctx.name, "STUDENT_ACCOUNT_DELETED", { targetUid: uid });
        return Response.json({ success: true });
    } catch (err) {
        console.error("[students API] deletion failed:", err);
        return Response.json({ error: "Failed to delete the student account." }, { status: 500 });
    }
}
