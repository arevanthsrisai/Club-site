import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, unauthorized } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { safeHttpUrl, safePhotoUrl } from "@/lib/publicUrl";

/**
 * Owner self-edit for one's own Ex-Core profile.
 *
 * PATCH { name?, photoURL?, bio?, socials? }
 *
 * Identity and ownership are established ONLY from the verified ID token:
 * the member record is resolved by linkedUserId == token uid, never by any
 * client-supplied id. Ex-Core owners cannot change their batch, role
 * history, classification or ordering here — privileged fields are rejected
 * even if the UI never offers them — and this route can never be tricked
 * into editing another member's profile.
 *
 * Authorization: an approved admin account (active status). Ex-Core members
 * whose linked account was revoked lose access with it.
 */
export async function PATCH(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!ctx.isAdmin) {
        return NextResponse.json({ error: "Your account does not have an active admin profile." }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;

        // Privileged fields must never pass here, even from a crafted request.
        const privileged = ["exCoreBatch", "memberType", "roleHistory", "displayOrder", "linkedUserId", "movedAt"];
        const hasPrivileged = Object.keys(body).some(k => privileged.includes(k));
        const allowed = ["name", "photoURL", "bio", "socials"];
        const fields = Object.keys(body).filter(k => allowed.includes(k));
        if (fields.length === 0 || hasPrivileged) {
            return NextResponse.json(
                { error: "You may only edit your name, photo, bio and links." },
                { status: 400 },
            );
        }

        const db = getAdminFirestore();
        // Ownership from the verified identity, not client data:
        const snap = await db.collection("ex_core_members").where("linkedUserId", "==", ctx.uid).limit(1).get();
        if (snap.empty) {
            return NextResponse.json({ error: "No Ex-Core profile is linked to your account." }, { status: 404 });
        }

        const ref = snap.docs[0].ref;
        const update: Record<string, unknown> = {};

        if (fields.includes("name")) {
            const name = String(body.name ?? "").trim();
            if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
            update.name = name;
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

        await ref.set(update, { merge: true });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("PATCH /api/ex-core/self failed:", err);
        return NextResponse.json({ error: "Failed to update your Ex-Core profile." }, { status: 500 });
    }
}

/**
 * GET /api/ex-core/self → the caller's own linked Ex-Core profile, for the
 * admin self-editing UI (does not leak other members).
 */
export async function GET(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!ctx.isAdmin) {
        return NextResponse.json({ error: "No active admin profile." }, { status: 403 });
    }
    try {
        const db = getAdminFirestore();
        const snap = await db.collection("ex_core_members").where("linkedUserId", "==", ctx.uid).limit(1).get();
        if (snap.empty) return NextResponse.json({ member: null });
        const d = snap.docs[0];
        return NextResponse.json({ member: { id: d.id, ...d.data() } });
    } catch (err: any) {
        console.error("GET /api/ex-core/self failed:", err);
        return NextResponse.json({ error: "Failed to load your Ex-Core profile." }, { status: 500 });
    }
}
