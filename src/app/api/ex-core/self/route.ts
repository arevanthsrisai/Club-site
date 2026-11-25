import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, logServerActivity, unauthorized } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { safeHttpUrl, safePhotoUrl } from "@/lib/publicUrl";
import {
    OWNER_EDITABLE_FIELDS, containsPrivilegedField, sanitizeRoleHistory,
    ExCoreMemberType,
} from "@/lib/excore";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Self-service API for one's OWN Ex-Core profile.
 *
 * GET   → the caller's linked Ex-Core profile (never anyone else's).
 * POST  → create the caller's own linked profile (used after onboarding as
 *         Ex-Core when no profile exists yet).
 * PATCH → edit the caller's own profile: name, photo, bio, socials, member
 *         category (Core/Activator) and role history.
 *
 * Identity and ownership are established ONLY from the verified ID token:
 * the member record is resolved by linkedUserId == token uid, never by a
 * client-supplied id, so this route can never edit another member's profile.
 * Ordering, account linking and legacy batch fields stay privileged: they are
 * rejected even if the UI never offers them.
 *
 * Authorization: an Ex-Core hand-off account (fixed ExCoreMember role or the
 * exCoreAt marker). These accounts hold zero admin authority — this route and
 * their own /admin/profile are the only things they can change.
 */

const PRIVILEGED_REJECT = "You cannot change the ordering, account link or legacy batch fields.";
const INVALID_CATEGORY = 'Member category must be "core" or "activator".';
/** Bound on tenure rows so a crafted payload cannot bloat the document. */
const MAX_HISTORY_ENTRIES = 20;

function parseMemberType(raw: unknown): ExCoreMemberType | null {
    if (raw === "core") return "core";
    if (raw === "activator") return "activator";
    return null;
}

/** Returns the caller's linked Ex-Core document, or null. */
async function findLinkedMember(uid: string) {
    const snap = await getAdminFirestore()
        .collection("ex_core_members")
        .where("linkedUserId", "==", uid)
        .limit(1)
        .get();
    return snap.empty ? null : snap.docs[0];
}

export async function GET(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!ctx.isAdmin && !ctx.isExCore) {
        return NextResponse.json({ error: "No active admin profile." }, { status: 403 });
    }
    try {
        const doc = await findLinkedMember(ctx.uid);
        if (!doc) return NextResponse.json({ member: null });
        return NextResponse.json({ member: { id: doc.id, ...doc.data() } });
    } catch (err: any) {
        console.error("GET /api/ex-core/self failed:", err);
        return NextResponse.json({ error: "Failed to load your Ex-Core profile." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!ctx.isExCore) {
        return NextResponse.json(
            { error: "Only Ex-Core accounts can create their own Ex-Core profile." },
            { status: 403 },
        );
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        if (containsPrivilegedField(body)) {
            return NextResponse.json({ error: PRIVILEGED_REJECT }, { status: 400 });
        }

        const existing = await findLinkedMember(ctx.uid);
        if (existing) {
            // Idempotent: a retry after a lost response returns the same profile.
            return NextResponse.json({ id: existing.id, existing: true });
        }

        const name = String(body.name ?? ctx.name ?? "").trim();
        if (!name) {
            return NextResponse.json({ error: "A name is required." }, { status: 400 });
        }
        if (name.length > 120) {
            return NextResponse.json({ error: "Name is too long." }, { status: 400 });
        }

        const memberType = parseMemberType(body.memberType ?? "core");
        if (!memberType) {
            return NextResponse.json({ error: INVALID_CATEGORY }, { status: 400 });
        }

        if (Array.isArray(body.roleHistory) && body.roleHistory.length > MAX_HISTORY_ENTRIES) {
            return NextResponse.json({ error: `Add at most ${MAX_HISTORY_ENTRIES} tenure entries.` }, { status: 400 });
        }
        const roleHistory = sanitizeRoleHistory(body.roleHistory);
        if (!roleHistory) {
            return NextResponse.json(
                { error: "Add at least one role with its start and end year (e.g. 2026 → 2028)." },
                { status: 400 },
            );
        }

        const db = getAdminFirestore();
        // The onboarding form's photo and social links live on admins/{uid}.
        // Copy them into the public profile when this create form omits them,
        // so a freshly onboarded Ex-Core member is not published with a blank
        // card. Explicit values in the request always win; later edits to My
        // Profile keep the two records in sync.
        const [siblings, adminSnap] = await Promise.all([
            db.collection("ex_core_members").get(),
            db.collection("admins").doc(ctx.uid).get(),
        ]);
        const adminData = (adminSnap.exists ? adminSnap.data() : {}) as {
            photoURL?: unknown;
            socials?: Record<string, unknown>;
        };
        const bodySocials = (body.socials ?? {}) as Record<string, unknown>;
        const adminSocials = adminData.socials ?? {};
        // Each link falls back independently, so a member who fills only one
        // network keeps that one and still inherits the others.
        const socialLink = (key: "linkedin" | "github" | "instagram") =>
            safeHttpUrl(String(bodySocials[key] ?? "")) ?? safeHttpUrl(String(adminSocials[key] ?? ""));

        const nextOrder = siblings.docs.reduce(
            (max, d) => Math.max(max, Number((d.data() as { displayOrder?: number }).displayOrder ?? -1) + 1),
            0,
        );

        const ref = db.collection("ex_core_members").doc();
        await ref.set({
            name,
            photoURL: safePhotoUrl(String(body.photoURL || "")) ?? safePhotoUrl(String(adminData.photoURL ?? "")),
            bio: String(body.bio ?? "").slice(0, 2000),
            socials: {
                linkedin: socialLink("linkedin"),
                github: socialLink("github"),
                instagram: socialLink("instagram"),
            },
            memberType,
            roleHistory,
            displayOrder: nextOrder,
            linkedUserId: ctx.uid,
            movedAt: Timestamp.now(),
        });

        await logServerActivity(ctx.uid, ctx.name, "EXCORE_SELF_CREATE", {
            memberId: ref.id,
            memberType,
            roleHistory,
        });

        return NextResponse.json({ id: ref.id });
    } catch (err: any) {
        console.error("POST /api/ex-core/self failed:", err);
        return NextResponse.json({ error: "Failed to create your Ex-Core profile." }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!ctx.isAdmin && !ctx.isExCore) {
        return NextResponse.json({ error: "Your account does not have an active admin profile." }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;

        // Privileged fields must never pass here, even from a crafted request.
        if (containsPrivilegedField(body)) {
            return NextResponse.json({ error: PRIVILEGED_REJECT }, { status: 400 });
        }
        const fields = Object.keys(body).filter(k =>
            (OWNER_EDITABLE_FIELDS as readonly string[]).includes(k),
        );
        if (fields.length === 0) {
            return NextResponse.json(
                { error: "Nothing to update. Edit your name, category, role history, bio or links." },
                { status: 400 },
            );
        }

        const doc = await findLinkedMember(ctx.uid);
        if (!doc) {
            return NextResponse.json(
                { error: "No Ex-Core profile is linked to your account. Create one first." },
                { status: 404 },
            );
        }

        const update: Record<string, unknown> = {};

        if (fields.includes("name")) {
            const name = String(body.name ?? "").trim();
            if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
            if (name.length > 120) return NextResponse.json({ error: "Name is too long." }, { status: 400 });
            update.name = name;
        }
        if (fields.includes("memberType")) {
            const memberType = parseMemberType(body.memberType);
            if (!memberType) return NextResponse.json({ error: INVALID_CATEGORY }, { status: 400 });
            update.memberType = memberType;
        }
        if (fields.includes("roleHistory")) {
            if (!Array.isArray(body.roleHistory)) {
                return NextResponse.json({ error: "Role history must be a list." }, { status: 400 });
            }
            if (body.roleHistory.length > MAX_HISTORY_ENTRIES) {
                return NextResponse.json({ error: `Add at most ${MAX_HISTORY_ENTRIES} tenure entries.` }, { status: 400 });
            }
            const history = sanitizeRoleHistory(body.roleHistory);
            // An empty list clears the history; a non-empty but invalid list is rejected
            // rather than silently wiping entries the member typed.
            if (!history && body.roleHistory.length > 0) {
                return NextResponse.json(
                    { error: "Each role needs a name and a valid start/end year." },
                    { status: 400 },
                );
            }
            update.roleHistory = history ?? [];
        }
        if (fields.includes("bio")) {
            update.bio = String(body.bio ?? "").slice(0, 2000);
        }
        if (fields.includes("photoURL")) {
            update.photoURL = safePhotoUrl(String(body.photoURL || ""));
        }
        if (fields.includes("socials")) {
            const s = (body.socials ?? {}) as Record<string, unknown>;
            update.socials = {
                linkedin: safeHttpUrl(String(s.linkedin ?? "")),
                github: safeHttpUrl(String(s.github ?? "")),
                instagram: safeHttpUrl(String(s.instagram ?? "")),
            };
        }

        await doc.ref.set(update, { merge: true });
        await logServerActivity(ctx.uid, ctx.name, "EXCORE_SELF_UPDATE", {
            memberId: doc.id,
            fields: Object.keys(update),
        });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("PATCH /api/ex-core/self failed:", err);
        return NextResponse.json({ error: "Failed to update your Ex-Core profile." }, { status: 500 });
    }
}
