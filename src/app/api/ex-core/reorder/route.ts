import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, logServerActivity, unauthorized } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { normalizeYear } from "@/lib/excore";

/**
 * Persisted custom ordering within one Ex-Core batch.
 *
 * POST { batch, order: [memberId, ...] }
 * The submitted order must contain exactly the set of members currently in
 * that batch (no missing, no extra) so a stale browser can never silently
 * drop someone. displayOrder is re-numbered 0..n-1 and stored in the
 * database — ordering survives reloads and devices, and alphabetical
 * sorting is never applied when a custom order exists.
 *
 * Authorization: isCTO OR "excore.manage". Ex-Core owners can never reach
 * this route.
 */
export async function POST(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "excore.manage")) {
        return NextResponse.json({ error: "Forbidden: requires the \"excore.manage\" permission" }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const batch = normalizeYear(body?.batch);
        const order: unknown = body?.order;

        if (batch === null) {
            return NextResponse.json({ error: "A valid batch year is required." }, { status: 400 });
        }
        if (!Array.isArray(order) || order.some(id => typeof id !== "string")) {
            return NextResponse.json({ error: "order must be an array of member ids." }, { status: 400 });
        }

        const db = getAdminFirestore();
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(
                db.collection("ex_core_members").where("exCoreBatch", "==", batch),
            );
            const currentIds = snap.docs.map(d => d.id);
            if (
                currentIds.length !== order.length ||
                new Set(currentIds).size !== currentIds.length ||
                !currentIds.every(id => (order as string[]).includes(id))
            ) {
                throw new Error("STALE_ORDER");
            }

            (order as string[]).forEach((id, index) => {
                tx.set(
                    db.collection("ex_core_members").doc(id),
                    { displayOrder: index },
                    { merge: true },
                );
            });
            return currentIds.length;
        });

        await logServerActivity(ctx.uid, ctx.name, "EXCORE_REORDER", { batch, count: result });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        if (err?.message === "STALE_ORDER") {
            return NextResponse.json(
                { error: "The list changed since you loaded it — refresh and try again." },
                { status: 409 },
            );
        }
        console.error("POST /api/ex-core/reorder failed:", err);
        return NextResponse.json({ error: "Failed to save the ordering." }, { status: 500 });
    }
}
