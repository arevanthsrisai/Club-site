import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import type { Query } from "firebase-admin/firestore";

/**
 * Admin Forms API — delete a form and all of its submissions.
 *
 * POST /api/admin/forms/delete  { id }
 *
 * Server-authorized with the events.manage permission; audited. Deleting a
 * form with submissions is confirmed twice in the UI (dialog + type-to-confirm).
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!hasPermission(ctx, "events.manage")) return forbidden("events.manage");

        const body = await request.json().catch(() => null);
        const id = body && typeof body.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(body.id) ? body.id : null;
        if (!id) return NextResponse.json({ error: "Form id is required." }, { status: 400 });

        const db = getAdminFirestore();
        const docRef = db.collection("forms").doc(id);
        const existing = await docRef.get();
        if (!existing.exists) {
            return NextResponse.json({ error: "This form no longer exists." }, { status: 404 });
        }

        // Delete the form plus all its submissions in batches.
        let deletedSubmissions = 0;
        let cursor: string | null = null;
        for (;;) {
            let q = db.collection("form_submissions").where("formId", "==", id).limit(400) as unknown as Query<Record<string, unknown>>;
            if (cursor) q = q.startAfter(cursor) as unknown as Query<Record<string, unknown>>;
            const snap = await q.get();
            if (snap.empty) break;
            const batch = db.batch();
            const ids: string[] = [];
            snap.forEach(s => {
                batch.delete(s.ref);
                ids.push(s.id);
            });
            await batch.commit();
            deletedSubmissions += ids.length;
            cursor = ids[ids.length - 1];
        }

        await docRef.delete();
        await logServerActivity(ctx.uid, ctx.name, "form.delete", {
            formId: id,
            title: existing.data()?.title ?? "",
            deletedSubmissions,
        });

        return NextResponse.json({ ok: true, deletedSubmissions });
    } catch (err) {
        console.error("Form delete error:", err);
        return NextResponse.json({ error: "Could not delete the form. Please try again." }, { status: 500 });
    }
}
