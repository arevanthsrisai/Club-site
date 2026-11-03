import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

/**
 * POST /api/admin/events/workflow
 * 
 * Restart, Stop, or Reset workflows (Registration, Attendance, Feedback) for an event.
 * 
 * Body:
 * - eventId: string
 * - workflow: "registration" | "attendance" | "feedback"
 * - action: "restart" | "stop" | "reset"
 * 
 * Restart: Reopen/start the workflow, preserving all historical data.
 * Stop: Close the workflow (mark as stopped/ended).
 * Reset: Clear all data for the selected workflow/event scope.
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!hasPermission(ctx, "events.manage")) return forbidden("events.manage");

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
        }

        const { eventId, workflow, action } = body as {
            eventId?: string;
            workflow?: "registration" | "attendance" | "feedback";
            action?: "restart" | "stop" | "reset";
        };

        if (!eventId || typeof eventId !== "string") {
            return NextResponse.json({ error: "Event ID is required." }, { status: 400 });
        }
        if (!workflow || !["registration", "attendance", "feedback"].includes(workflow)) {
            return NextResponse.json({ error: "Valid workflow is required (registration, attendance, or feedback)." }, { status: 400 });
        }
        if (!action || !["restart", "stop", "reset"].includes(action)) {
            return NextResponse.json({ error: "Valid action is required (restart, stop, or reset)." }, { status: 400 });
        }

        const db = getAdminFirestore();
        const eventRef = db.collection("events").doc(eventId);
        const eventDoc = await eventRef.get();

        if (!eventDoc.exists) {
            return NextResponse.json({ error: "Event not found." }, { status: 404 });
        }

        const now = Timestamp.now();

        if (action === "reset") {
            // RESET: Clear all data for the selected workflow
            await db.runTransaction(async (tx) => {
                if (workflow === "registration") {
                    // Delete all registrations for this event
                    const regsSnap = await tx.get(db.collection("registrations").where("eventId", "==", eventId));
                    regsSnap.forEach(doc => tx.delete(doc.ref));
                    // Reset event registration status
                    tx.update(eventRef, {
                        registrationStatus: "upcoming",
                        registrationResetAt: now,
                    });
                } else if (workflow === "attendance") {
                    // Delete all attendance sessions for this event
                    const sessionsSnap = await tx.get(db.collection("attendance_sessions").where("eventId", "==", eventId));
                    sessionsSnap.forEach(doc => tx.delete(doc.ref));
                    // Delete all attendance records
                    const recordsSnap = await tx.get(db.collection("attendance_records").where("eventId", "==", eventId));
                    recordsSnap.forEach(doc => tx.delete(doc.ref));
                    // Reset event attendance status
                    tx.update(eventRef, {
                        attendanceStatus: "upcoming",
                        attendanceResetAt: now,
                    });
                    // Also delete the secret code doc if it exists
                    tx.delete(db.collection("event_secrets").doc(eventId));
                } else if (workflow === "feedback") {
                    // Delete all feedback submissions for this event
                    const feedbacksSnap = await tx.get(db.collection("feedbacks").where("eventId", "==", eventId));
                    feedbacksSnap.forEach(doc => tx.delete(doc.ref));
                    // Reset event feedback status
                    tx.update(eventRef, {
                        isFeedbackOpen: false,
                        feedbackStatus: "upcoming",
                        feedbackResetAt: now,
                        avgRating: 0,
                        feedbackCount: 0,
                    });
                }
            });

            await logServerActivity(ctx.uid, ctx.name, "event.workflow.reset", {
                eventId,
                workflow,
            });

            return NextResponse.json({ ok: true, message: `${workflow} workflow reset successfully.` });
        } else if (action === "stop") {
            // STOP: Close the workflow (mark as stopped/ended)
            const currentRegStatus = eventDoc.data()?.registrationStatus ?? "upcoming";
            const currentAttStatus = eventDoc.data()?.attendanceStatus ?? "upcoming";
            const currentFbStatus = eventDoc.data()?.feedbackStatus ?? (eventDoc.data()?.isFeedbackOpen ? "active" : "upcoming");

            await db.runTransaction(async (tx) => {
                if (workflow === "registration") {
                    if (currentRegStatus !== "open") {
                        throw new Error("Registration is not open. Nothing to stop.");
                    }
                    tx.update(eventRef, {
                        registrationStatus: "closed",
                        registrationStoppedAt: now,
                    });
                } else if (workflow === "attendance") {
                    if (currentAttStatus !== "active") {
                        throw new Error("Attendance is not active. Nothing to stop.");
                    }
                    const sessionId = eventDoc.data()?.attendanceSessionId;
                    if (sessionId) {
                        tx.update(db.collection("attendance_sessions").doc(sessionId), {
                            endedAt: now.toMillis(),
                        });
                    }
                    tx.update(eventRef, {
                        attendanceStatus: "ended",
                        attendanceStoppedAt: now,
                    });
                    // Remove the active attendance code so check-ins are blocked
                    tx.delete(db.collection("event_secrets").doc(eventId));
                } else if (workflow === "feedback") {
                    if (!(currentFbStatus === "active" || eventDoc.data()?.isFeedbackOpen === true)) {
                        throw new Error("Feedback is not open. Nothing to stop.");
                    }
                    tx.update(eventRef, {
                        isFeedbackOpen: false,
                        feedbackStatus: "ended",
                        feedbackStoppedAt: now,
                    });
                }
            });

            await logServerActivity(ctx.uid, ctx.name, "event.workflow.stop", {
                eventId,
                workflow,
            });

            return NextResponse.json({ ok: true, message: `${workflow} workflow stopped successfully.` });
        } else {
            // RESTART: Reopen/start the workflow without deleting data
            // Validate current state before allowing restart
            const currentRegStatus = eventDoc.data()?.registrationStatus ?? "upcoming";
            const currentAttStatus = eventDoc.data()?.attendanceStatus ?? "upcoming";
            const currentFbStatus = eventDoc.data()?.feedbackStatus ?? (eventDoc.data()?.isFeedbackOpen ? "active" : "upcoming");

            await db.runTransaction(async (tx) => {
                if (workflow === "registration") {
                    // Allow restart when closed (stopped) or upcoming (not-started)
                    // Reject if already open (live)
                    if (currentRegStatus === "open") {
                        throw new Error("Registration is already open. Restart is only available when stopped.");
                    }
                    tx.update(eventRef, {
                        registrationStatus: "open",
                        registrationRestartedAt: now,
                    });
                } else if (workflow === "attendance") {
                    // Allow restart when ended (stopped) or upcoming (not-started)
                    // Reject if already active (live)
                    if (currentAttStatus === "active") {
                        throw new Error("Attendance is already active. Stop it first before restarting.");
                    }
                    // Generate a new attendance code for the new session
                    const code = Math.floor(1000 + Math.random() * 9000).toString();
                    const sessionId = `${eventId}_${now.toMillis()}`;
                    tx.set(db.collection("attendance_sessions").doc(sessionId), {
                        id: sessionId,
                        eventId,
                        code,
                        startedAt: now.toMillis(),
                        endedAt: null,
                    });
                    tx.set(db.collection("event_secrets").doc(eventId), { code, sessionId, failures: {} }, { merge: true });
                    tx.update(eventRef, {
                        attendanceStatus: "active",
                        attendanceSessionId: sessionId,
                        attendanceRestartedAt: now,
                    });
                } else if (workflow === "feedback") {
                    // Allow restart when ended (stopped) or upcoming (not-started)
                    // Reject if already open (live)
                    if (currentFbStatus === "active" || eventDoc.data()?.isFeedbackOpen === true) {
                        throw new Error("Feedback is already open. Restart is only available when stopped.");
                    }
                    tx.update(eventRef, {
                        isFeedbackOpen: true,
                        feedbackStatus: "active",
                        feedbackRestartedAt: now,
                    });
                }
            });

            await logServerActivity(ctx.uid, ctx.name, "event.workflow.restart", {
                eventId,
                workflow,
            });

            return NextResponse.json({ ok: true, message: `${workflow} workflow restarted successfully.` });
        }
    } catch (err: unknown) {
        console.error("Workflow action error:", err);
        return NextResponse.json({ error: "Could not complete the workflow action. Please try again." }, { status: 500 });
    }
}
