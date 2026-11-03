import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, logServerActivity, unauthorized } from "@/lib/serverAuthz";
import { DEFAULT_ROLES, EX_CORE_ROLE, DEFAULT_ROLE_ID } from "@/lib/roles";

/**
 * Server-authorized club-role assignment during onboarding.
 *
 * Post /api/admin/onboarding/role  { clubRole: "Activator" | "ExCoreMember" }
 *
 * Firestore rules never let an owner set their own `role`, so this route is
 * the only self-service path. It is deliberately narrow:
 * - the caller must hold a verified token and an admin profile;
 * - their current role must already be one of the non-privileged roles
 *   ("pending", Activator, Ex-Core Member);
 * - the target role must be Activator or Ex-Core Member — nothing above them
 *   is assignable, and only the CTO's Approve action grants Activator access;
 * - a pending account may only choose Ex-Core (that is how Ex-Core users
 *   finish their own signup) — choosing it flips "pending" to the ExCoreMember
 *   role and starts onboarding server-side;
 * - an already-approved account may swap between Activator and Ex-Core only
 *   while it is still in onboarding (status "onboarding"); afterwards only
 *   the CTO assigns roles again.
 */

const SELF_ASSIGNABLE = new Set([DEFAULT_ROLE_ID, EX_CORE_ROLE.id]);
const ONBOARDABLE_CURRENT_ROLES = new Set(["pending", DEFAULT_ROLE_ID, EX_CORE_ROLE.id]);

export async function POST(request: NextRequest) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();

        const body = await request.json().catch(() => ({}));
        const clubRole = typeof body?.clubRole === "string" ? body.clubRole : "";

        if (!ONBOARDABLE_CURRENT_ROLES.has(ctx.role)) {
            return NextResponse.json(
                { error: "Your club role is managed by the CTO and cannot be changed here." },
                { status: 403 },
            );
        }

        if (!SELF_ASSIGNABLE.has(clubRole)) {
            return NextResponse.json(
                { error: "Only the Activator or Ex-Core roles can be selected during onboarding." },
                { status: 400 },
            );
        }

        // Still-pending accounts have no approval yet: they may board as Ex-Core only.
        if (ctx.role === "pending" && clubRole === DEFAULT_ROLE_ID) {
            return NextResponse.json(
                { error: "Activator access requires admin approval." },
                { status: 403 },
            );
        }

        const db = (await import("@/lib/firebaseAdmin")).getAdminFirestore();
        const adminRef = db.collection("admins").doc(ctx.uid);
        const adminDoc = await adminRef.get();
        if (!adminDoc.exists) return unauthorized();

        // Open choices only during onboarding. Once active, the CTO manages roles.
        const currentStatus = adminDoc.data()?.status;
        if (currentStatus === "active") {
            return NextResponse.json(
                { error: "Your profile is already active — ask the CTO to change your role." },
                { status: 403 },
            );
        }

        // Seat limit for Activator (Ex-Core Member is fixed in code with no limit).
        if (clubRole === DEFAULT_ROLE_ID && ctx.role !== DEFAULT_ROLE_ID) {
            const snap = await db.collection("club_roles").doc(DEFAULT_ROLE_ID).get();
            const stored = snap.exists ? (snap.data() as { limit?: number | null }) : undefined;
            const fallback = DEFAULT_ROLES.find(r => r.id === DEFAULT_ROLE_ID);
            const limit = stored ? stored.limit ?? null : fallback?.limit ?? null;
            if (limit !== null) {
                const countSnap = await db.collection("admins")
                    .where("role", "==", DEFAULT_ROLE_ID)
                    .where("status", "==", "active")
                    .count()
                    .get();
                if (countSnap.data().count >= limit) {
                    return NextResponse.json({ error: `Seat limit reached for Activator.` }, { status: 409 });
                }
            }
        }

        const update: Record<string, unknown> = { role: clubRole };
        if (ctx.role === "pending") {
            // Pending → Ex-Core starts onboarding normally, so the standard
            // owner self-update to status "active" stays rule-compliant.
            update.status = "onboarding";
        }
        await adminRef.set(update, { merge: true });

        await logServerActivity(ctx.uid, ctx.name, "ONBOARDING_ROLE_SET", {
            previousRole: ctx.role,
            newRole: clubRole,
        });

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[onboarding/role] Failed:", message);
        return NextResponse.json({ error: "Failed to set the club role: " + message }, { status: 500 });
    }
}
