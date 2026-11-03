import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { normalizeFormPayload } from "@/lib/forms";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Admin Forms API — create or update a form.
 *
 * POST /api/admin/forms/save  { id?: string, form: <normalizeFormPayload input> }
 *
 * Every operation is server-authorized with the events.manage permission and
 * audited. The client (form builder) sends the whole payload; normalizeFormPayload
 * is the shared validation used by both the builder UI and this route.
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!hasPermission(ctx, "events.manage")) return forbidden("events.manage");

        const body = await request.json().catch(() => null);
        const id = body && typeof body.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(body.id) ? body.id : null;
        const result = normalizeFormPayload(body?.form);
        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }
        const { title, description, status, eventId, opensAt, closesAt, fields } = result.value;

        const db = getAdminFirestore();
        const now = Timestamp.now();
        let docRef = db.collection("forms").doc();

        if (id) {
            docRef = db.collection("forms").doc(id);
            const existing = await docRef.get();
            if (!existing.exists) {
                return NextResponse.json({ error: "This form was deleted by someone else." }, { status: 404 });
            }
            // An event is an immutable anchor of a form.
            const existingData = existing.data();
            if (typeof existingData?.eventId === "string" && existingData.eventId !== eventId) {
                return NextResponse.json({ error: "A form's event cannot be changed after creation." }, { status: 400 });
            }
        }

        // The referenced event must exist.
        const eventDoc = await db.collection("events").doc(eventId).get();
        if (!eventDoc.exists) {
            return NextResponse.json({ error: "The selected event does not exist." }, { status: 400 });
        }

        const fd: Record<string, unknown> = {
            eventId,
            title,
            description,
            status,
            opensAt: opensAt ? Timestamp.fromDate(opensAt) : null,
            closesAt: closesAt ? Timestamp.fromDate(closesAt) : null,
            fields,
            updatedAt: now,
            updatedBy: ctx.uid,
            updatedByName: ctx.name,
        };

        let isNew = false;
        await db.runTransaction(async (tx) => {
            if (id) {
                const snap = await tx.get(docRef);
                if (!snap.exists) throw Object.assign(new Error("deleted"), { code: "GONE" });
                fd.createdAt = snap.data()?.createdAt ?? now;
                fd.createdBy = snap.data()?.createdBy ?? ctx.uid;
                fd.submissionCount = snap.data()?.submissionCount ?? 0;
            } else {
                isNew = true;
                fd.createdAt = now;
                fd.createdBy = ctx.uid;
                fd.submissionCount = 0;
            }
            tx.set(docRef, fd, { merge: false });
        }).catch((err) => {
            if (err?.code === "GONE") {
                throw Object.assign(err, { handled: true });
            }
            throw err;
        });

        await logServerActivity(ctx.uid, ctx.name, isNew ? "form.create" : "form.update", {
            formId: docRef.id,
            title,
            status,
            fields: fields.length,
        });

        return NextResponse.json({ ok: true, id: docRef.id });
    } catch (err: unknown) {
        if ((err as { handled?: boolean })?.handled) {
            return NextResponse.json({ error: "This form was deleted by someone else." }, { status: 404 });
        }
        console.error("Form save error:", err);
        return NextResponse.json({ error: "Could not save the form. Please try again." }, { status: 500 });
    }
}
