import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/serverAuth";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { checkRateLimit } from "@/lib/rateLimit";
import { computeAvailability, AVAILABILITY_MESSAGE, persistableAnswers, validateSubmission } from "@/lib/forms";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Public form submission endpoint.
 *
 * POST /api/forms/submit  { formId, answers }
 *
 * The server re-checks everything that could have been forged client-side:
 * the form's existence, its availability (status + open/close window),
 * per-field validation against the stored field definitions, duplicate
 * submissions for signed-in users and a per-user/IP rate limit.
 */

const SUBMIT_LIMIT = { max: 8, windowMs: 10 * 60 * 1000, keyPrefix: "formSubmit" } as const;

function clientKey(request: NextRequest, uid: string | null): string {
    if (uid) return uid;
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    return `anon:${ip}`;
}

function clientIp(request: NextRequest): string {
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    // Truncated hex — rate-limit anonymity for anonymous submitters without storing a raw address.
    return ip ? Buffer.from(ip).toString("hex").slice(0, 16) : "";
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const formId = body && typeof body.formId === "string" ? body.formId.trim() : "";
        if (!formId || formId.length > 100) {
            return NextResponse.json({ error: "Invalid form." }, { status: 400 });
        }

        const auth = await verifyAuthToken(request);
        const uid = auth?.uid ?? null;

        const rl = await checkRateLimit(clientKey(request, uid), "formSubmit", SUBMIT_LIMIT);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Too many submissions. Please wait a few minutes and try again." },
                { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)) } }
            );
        }

        if (typeof body?.answers !== "object" || body === null || Array.isArray(body.answers)) {
            return NextResponse.json({ error: "The answers payload is not valid." }, { status: 400 });
        }

        const db = getAdminFirestore();
        const formDoc = await db.collection("forms").doc(formId).get();
        if (!formDoc.exists) {
            return NextResponse.json({ error: "This form does not exist anymore." }, { status: 404 });
        }
        const fd = formDoc.data() as {
            status?: string;
            eventId?: string | null;
            opensAt?: Date | null;
            closesAt?: Date | null;
            fields?: unknown;
        };

        // Availability is enforced HERE, not just in the UI.
        const availability = computeAvailability(
            {
                status: (fd.status ?? "draft") as "draft" | "published" | "closed",
                opensAt: fd.opensAt ? new Date(fd.opensAt as unknown as number).toISOString() : null,
                closesAt: fd.closesAt ? new Date(fd.closesAt as unknown as number).toISOString() : null,
            }
        );
        if (availability !== "open") {
            return NextResponse.json({ error: AVAILABILITY_MESSAGE[availability] }, { status: 403 });
        }

        const becameFields = Array.isArray(fd.fields) ? fd.fields : [];

        const fieldErrors = validateSubmission({ fields: becameFields as never }, body.answers);
        if (Object.keys(fieldErrors).length > 0) {
            return NextResponse.json({ error: "Some answers are not valid. Fix them and try again.", fieldErrors }, { status: 400 });
        }

        const answers = persistableAnswers(becameFields as never, body.answers);

        // Denormalize the eventId from the parent form so submissions can be
        // queried per event without joining forms.
        const eventId = fd.eventId ?? null;

        // Signed-in users submit exactly once per form (deterministic id).
        const submissionId = uid ? `${formId}_${uid}` : `${formId}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        const submissionRef = db.collection("form_submissions").doc(submissionId);
        if (uid) {
            const existing = await submissionRef.get();
            if (existing.exists) {
                return NextResponse.json({ error: "You have already submitted this form.", code: "ALREADY_SUBMITTED" }, { status: 409 });
            }
        }

        // Identity: real account data when signed in; anonymous stays anonymous.
        let userName = "";
        let userEmail = "";
        if (uid) {
            userEmail = auth?.email ?? "";
            const userDoc = await db.collection("users").doc(uid).get();
            const ud = userDoc.data() as { displayName?: string; email?: string; name?: string } | undefined;
            userName = (ud?.displayName || ud?.name || "").slice(0, 100);
            if (!userEmail && ud?.email) userEmail = ud.email;
        }

        const batch = db.batch();
        batch.set(submissionRef, {
            formId,
            eventId,
            answers,
            userName,
            userEmail,
            userId: uid,
            submittedAt: Timestamp.now(),
        });
        batch.update(db.collection("forms").doc(formId), {
            submissionCount: FieldValue.increment(1),
        });
        await batch.commit();

        return NextResponse.json({ ok: true, submissionId });
    } catch (error) {
        console.error("Form submit error:", error);
        return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
}
