import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { buildExport, exportFilename, type ExportFormatId, type ExportPayload } from "@/lib/export/formExports";
import type { ExportSubmission } from "@/lib/forms";

/**
 * POST /api/admin/events/export
 *
 * Multi-format export for event workflows: Registration, Attendance, and Feedback.
 *
 * Body:
 * - eventId: string
 * - workflow: "registration" | "attendance" | "feedback"
 * - format: "csv" | "xlsx" | "pdf" | "docx" | "json" | "txt" | "html"
 * - search?: string (optional filter)
 *
 * Returns the generated file as a download.
 */

const ISO_SHAPE = /^[A-Za-z0-9_-]{1,80}$/;

function isoString(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && "toDate" in v) {
        try { return (v as { toDate(): Date }).toDate().toISOString(); } catch { return null; }
    }
    if (v && typeof v === "object" && "seconds" in v) {
        // Firestore client Timestamp-like object
        try { return new Date((v as { seconds: number }).seconds * 1000).toISOString(); } catch { return null; }
    }
    return null;
}

export async function POST(request: NextRequest) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!hasPermission(ctx, "events.manage")) return forbidden("events.manage");

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
        }

        const eventId = typeof body.eventId === "string" ? body.eventId : null;
        const workflow = typeof body.workflow === "string" ? body.workflow : null;
        const format = (body?.format ?? "csv") as ExportFormatId;
        const search = typeof body?.search === "string" ? body.search.trim().toLowerCase() : "";

        if (!eventId || !ISO_SHAPE.test(eventId)) {
            return NextResponse.json({ error: "Event ID is required." }, { status: 400 });
        }
        if (!workflow || !["registration", "attendance", "feedback"].includes(workflow)) {
            return NextResponse.json({ error: "Valid workflow is required (registration, attendance, or feedback)." }, { status: 400 });
        }
        if (!["csv", "xlsx", "pdf", "docx", "json", "txt", "html"].includes(format)) {
            return NextResponse.json({ error: "Unknown export format." }, { status: 400 });
        }

        const db = getAdminFirestore();

        // Fetch event doc for the title
        const eventDoc = await db.collection("events").doc(eventId).get();
        if (!eventDoc.exists) {
            return NextResponse.json({ error: "Event not found." }, { status: 404 });
        }
        const eventData = eventDoc.data() as Record<string, unknown> | undefined;
        const eventTitle = eventData?.title ?? "Event";
        const eventDate = typeof eventData?.date === "string" ? eventData.date : "";

        // Load data based on workflow
        const allRecords: Array<Record<string, unknown>> = [];

        if (workflow === "registration") {
            const snap = await db.collection("registrations").where("eventId", "==", eventId).orderBy("registeredAt", "desc").get();
            snap.forEach(d => allRecords.push({ id: d.id, ...d.data() }));
        } else if (workflow === "attendance") {
            // Attendance records
            const snap = await db.collection("attendance_records").where("eventId", "==", eventId).orderBy("checkedInAt", "desc").get();
            snap.forEach(d => allRecords.push({ id: d.id, ...d.data() }));
        } else if (workflow === "feedback") {
            const snap = await db.collection("feedbacks").where("eventId", "==", eventId).orderBy("submittedAt", "desc").get();
            snap.forEach(d => allRecords.push({ id: d.id, ...d.data() }));
        }

        // Search filter
        let filtered = allRecords;
        if (search) {
            filtered = allRecords.filter(r => {
                return Object.values(r).some(v => {
                    if (typeof v === "string") return v.toLowerCase().includes(search);
                    if (typeof v === "number") return String(v).includes(search);
                    return false;
                });
            });
        }

        // Build export payload based on workflow
        const workflowLabels: Record<string, string> = { registration: "Registration", attendance: "Attendance", feedback: "Feedback" };
        const formTitle = `${eventTitle} — ${workflowLabels[workflow] ?? workflow}`;

        // Build submissions for the export generator
        const submissions: ExportSubmission[] = filtered.map(r => {
            const answers: Record<string, string | number | boolean> = {};
            const recordId = typeof r.id === "string" ? r.id : "";

            if (workflow === "registration") {
                const ud = (r.userDetails ?? {}) as Record<string, unknown>;
                answers["name"] = typeof ud.name === "string" ? ud.name : "";
                answers["email"] = typeof ud.email === "string" ? ud.email : "";
                answers["rollNo"] = typeof ud.rollNo === "string" ? ud.rollNo : "";
                answers["class"] = typeof ud.class === "string" ? ud.class : "";
                answers["section"] = typeof ud.section === "string" ? ud.section : "";
                answers["mobile"] = typeof ud.mobile === "string" ? ud.mobile : "";
                answers["teamName"] = typeof r.teamName === "string" ? r.teamName : "";
                answers["status"] = typeof r.status === "string" ? r.status : "";
            } else if (workflow === "attendance") {
                answers["name"] = typeof r.userName === "string" ? r.userName : "";
                answers["rollNo"] = typeof r.rollNo === "string" ? r.rollNo : "";
                answers["sessionId"] = typeof r.sessionId === "string" ? r.sessionId : "";
                answers["code"] = typeof r.code === "string" ? r.code : "";
            } else if (workflow === "feedback") {
                answers["name"] = typeof r.userName === "string" ? r.userName : "";
                answers["overallRating"] = typeof r.overallRating === "number" ? r.overallRating : 0;
                answers["opinion"] = typeof r.opinion === "string" ? r.opinion : "";
                // Matrix ratings
                const matrix = (r.matrixRatings ?? {}) as Record<string, unknown>;
                for (const [k, v] of Object.entries(matrix)) {
                    answers[`matrix_${k}`] = typeof v === "number" ? v : 0;
                }
            }

            return {
                id: recordId,
                answers,
                userName: answers["name"] as string,
                userEmail: (answers["email"] ?? "") as string,
                submittedAt: isoString(r.registeredAt ?? r.checkedInAt ?? r.submittedAt),
            };
        });

        // Build form fields for export columns (minimal shape for export generator)
        type MinimalField = { id: string; label: string; type: "shortText" | "email" | "phone" | "number" | "longText"; required: boolean };
        const fields: MinimalField[] = workflow === "registration"
            ? [
                { id: "name", label: "Full Name", type: "shortText", required: false },
                { id: "email", label: "Email", type: "email", required: false },
                { id: "rollNo", label: "Roll Number", type: "shortText", required: false },
                { id: "class", label: "Class", type: "shortText", required: false },
                { id: "section", label: "Section", type: "shortText", required: false },
                { id: "mobile", label: "Mobile", type: "phone", required: false },
                { id: "teamName", label: "Team Name", type: "shortText", required: false },
                { id: "status", label: "Status", type: "shortText", required: false },
            ]
            : workflow === "attendance"
                ? [
                    { id: "name", label: "Name", type: "shortText", required: false },
                    { id: "rollNo", label: "Roll Number", type: "shortText", required: false },
                    { id: "sessionId", label: "Session ID", type: "shortText", required: false },
                    { id: "code", label: "Code", type: "shortText", required: false },
                ]
                : [
                    { id: "name", label: "Name", type: "shortText", required: false },
                    { id: "overallRating", label: "Overall Rating (1-5)", type: "number", required: false },
                    { id: "matrix_content", label: "Content", type: "number", required: false },
                    { id: "matrix_activities", label: "Activities", type: "number", required: false },
                    { id: "matrix_interaction", label: "Interaction", type: "number", required: false },
                    { id: "matrix_organization", label: "Organization", type: "number", required: false },
                    { id: "matrix_enjoyment", label: "Enjoyment", type: "number", required: false },
                    { id: "matrix_knowledgeable", label: "Knowledgeable", type: "number", required: false },
                    { id: "opinion", label: "Comments", type: "longText", required: false },
                ];

        const payload: ExportPayload = {
            form: {
                id: eventId,
                title: formTitle,
                description: `Event: ${eventTitle}${eventDate ? ` on ${eventDate}` : ""} — ${workflowLabels[workflow]} records`,
                status: workflow,
                fields,
                createdAt: null,
                updatedAt: null,
                opensAt: null,
                closesAt: null,
            },
            submissions,
        };

        const { body: fileBody, contentType, ext } = await buildExport(format, payload);
        const filename = exportFilename(formTitle, ext);

        await logServerActivity(ctx.uid, ctx.name, "event.export", {
            eventId,
            workflow,
            format,
            count: filtered.length,
            search: search || null,
        });

        return new NextResponse(new Uint8Array(fileBody), {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (err) {
        console.error("Event export error:", err);
        return NextResponse.json({ error: "Could not generate the export. Please try again." }, { status: 500 });
    }
}
