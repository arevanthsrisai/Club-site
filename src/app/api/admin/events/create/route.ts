import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Create a new event with automatically generated Registration, Attendance,
 * and Feedback forms. Uses a transaction to ensure atomicity.
 *
 * POST /api/admin/events/create  { event: <Event data>, forms?: { registration: <form config>, feedback: <form config> } }
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!hasPermission(ctx, "events.manage")) return forbidden("events.manage");

        const body = await request.json().catch(() => null);
        if (!body || typeof body.event !== "object") {
            return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
        }

        const { event } = body;
        const now = Timestamp.now();
        const db = getAdminFirestore();

        // Validate required fields
        if (!event?.title?.trim()) {
            return NextResponse.json({ error: "Event title is required." }, { status: 400 });
        }

        const eventDocRef = db.collection("events").doc();
        const eventData: Record<string, unknown> = {
            id: eventDocRef.id,
            title: event.title.trim(),
            date: event.date || "",
            time: event.time || "",
            venue: event.venue || "",
            description: event.description || "",
            fullDescription: event.fullDescription || "",
            details: event.details || [],
            image: event.image || "",
            status: event.status || "upcoming",
            registrationStatus: event.registrationStatus || "upcoming",
            attendanceStatus: event.attendanceStatus || "upcoming",
            feedbackStatus: event.feedbackStatus || "upcoming",
            isFeedbackOpen: event.isFeedbackOpen || false,
            avgRating: event.avgRating || 0,
            feedbackCount: event.feedbackCount || 0,
            minTeamSize: event.minTeamSize || 1,
            maxTeamSize: event.maxTeamSize || 1,
            createdAt: now,
            createdBy: ctx.uid,
            createdByName: ctx.name,
        };

        // Default registration form fields (Name, Email, Roll No, Class, Mobile)
        const defaultRegistrationFields = [
            { id: "name", type: "shortText", label: "Full Name", required: true, placeholder: "Enter your full name" },
            { id: "email", type: "email", label: "Email", required: true, placeholder: "you@example.com" },
            { id: "rollNo", type: "shortText", label: "Roll Number", required: true, placeholder: "e.g. 21XXX1234" },
            { id: "class", type: "shortText", label: "Class", required: true, placeholder: "e.g. B.Tech CSE" },
            { id: "mobile", type: "phone", label: "Mobile", required: false, placeholder: "Your mobile number" },
        ];

        // Default feedback form fields
        const defaultFeedbackFields = [
            { id: "overallRating", type: "number", label: "Overall Rating (1-5)", required: true, min: 1, max: 5 },
            { id: "content", type: "number", label: "Content Quality (1-5)", required: false, min: 1, max: 5 },
            { id: "organization", type: "number", label: "Organization (1-5)", required: false, min: 1, max: 5 },
            { id: "enjoyment", type: "number", label: "Enjoyment (1-5)", required: false, min: 1, max: 5 },
            { id: "opinion", type: "longText", label: "Comments & Suggestions", required: false, placeholder: "Share your thoughts..." },
        ];

        const regFormRef = db.collection("forms").doc();
        const feedbackFormRef = db.collection("forms").doc();

        await db.runTransaction(async (tx) => {
            // 1. Create the event document
            tx.set(eventDocRef, eventData);

            // 2. Create Registration form
            tx.set(regFormRef, {
                eventId: eventDocRef.id,
                title: `${event.title.trim()} — Registration`,
                description: event.description ? `Register for ${event.title.trim()}. ${event.description}` : `Register for ${event.title.trim()}.`,
                status: "draft" as const,
                opensAt: null,
                closesAt: null,
                fields: defaultRegistrationFields,
                createdAt: now,
                updatedAt: now,
                createdBy: ctx.uid,
                updatedBy: ctx.uid,
                createdByName: ctx.name,
                updatedByName: ctx.name,
                submissionCount: 0,
            });

            // 3. Create Feedback form
            tx.set(feedbackFormRef, {
                eventId: eventDocRef.id,
                title: `${event.title.trim()} — Feedback`,
                description: event.description ? `Share your feedback for ${event.title.trim()}. ${event.description}` : `Share your feedback for ${event.title.trim()}.`,
                status: "draft" as const,
                opensAt: null,
                closesAt: null,
                fields: defaultFeedbackFields,
                createdAt: now,
                updatedAt: now,
                createdBy: ctx.uid,
                updatedBy: ctx.uid,
                createdByName: ctx.name,
                updatedByName: ctx.name,
                submissionCount: 0,
            });
        });

        await logServerActivity(ctx.uid, ctx.name, "event.create", {
            eventId: eventDocRef.id,
            title: eventData.title,
            registrationFormId: regFormRef.id,
            feedbackFormId: feedbackFormRef.id,
        });

        return NextResponse.json({
            ok: true,
            eventId: eventDocRef.id,
            registrationFormId: regFormRef.id,
            feedbackFormId: feedbackFormRef.id,
        });
    } catch (err: unknown) {
        console.error("Event creation error:", err);
        return NextResponse.json({ error: "Could not create the event. Please try again." }, { status: 500 });
    }
}
