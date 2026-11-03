import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import type { Timestamp, Query } from "firebase-admin/firestore";
import { buildExport, exportFilename, type ExportFormatId, type ExportPayload } from "@/lib/export/formExports";
import type { ExportSubmission } from "@/lib/forms";

/**
 * Admin Forms API — registration export for a form.
 *
 * POST /api/admin/forms/export  { id, format, search? }
 *
 * Server-authorized with the events.manage permission. Data is loaded from
 * Firestore with cursor-paginated reads (batched, no N+1) and passed to the
 * format builder in src/lib/export/formExports.ts. The search matches the
 * registrations page's search filter so admins can export exactly what is
 * on screen, or omit `search` for everything.
 */

const ISO_SHAPE = /^[A-Za-z0-9_-]{1,80}$/;

function iso(ts: Timestamp | null | undefined, ...rest: unknown[]): string | null {
    const t = ts ?? null;
    if (t && typeof t.toDate === "function") {
        try { return t.toDate().toISOString(); } catch { return null; }
    }
    return null;
}

export async function POST(request: NextRequest) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!hasPermission(ctx, "events.manage")) return forbidden("events.manage");

        const body = await request.json().catch(() => null);
        const id = body && typeof body.id === "string" && ISO_SHAPE.test(body.id) ? body.id : null;
        const format = (body?.format ?? "csv") as ExportFormatId;
        const search = typeof body?.search === "string" ? body.search.trim().toLowerCase() : "";

        if (!id) return NextResponse.json({ error: "Form id is required." }, { status: 400 });
        if (!["csv", "xlsx", "pdf", "docx", "json", "txt", "html"].includes(format)) {
            return NextResponse.json({ error: "Unknown export format." }, { status: 400 });
        }

        const db = getAdminFirestore();
        const formDoc = await db.collection("forms").doc(id).get();
        if (!formDoc.exists) {
            return NextResponse.json({ error: "This form no longer exists." }, { status: 404 });
        }
        const fd = formDoc.data() as {
            title?: string; description?: string; status?: string;
            createdAt?: Timestamp; updatedAt?: Timestamp; opensAt?: Timestamp; closesAt?: Timestamp;
            fields?: { id: string }[];
        } | undefined;

        // Load submissions in cursor batches (efficient for large sets — no full-scan fetch all).
        // Fetch without orderBy to avoid requiring composite indexes, then sort in memory.
        const fieldIds = new Set((fd?.fields ?? []).map(f => f.id));
        const submissions: ExportSubmission[] = [];
        let cursor: string | null = null;
        for (;;) {
            let q = db.collection("form_submissions")
                .where("formId", "==", id)
                .limit(400) as unknown as Query<{ [key: string]: unknown }>;
            if (cursor) q = q.startAfter(cursor) as unknown as Query<{ [key: string]: unknown }>;
            const snap = await q.get();
            if (snap.empty) break;
            snap.forEach(s => {
                const d = s.data();
                const answers = (d?.answers ?? {}) as Record<string, unknown>;
                const removedFieldIds = Object.keys(answers).filter(k => !fieldIds.has(k));
                submissions.push({
                    id: s.id,
                    answers: answers as never,
                    userName: typeof d?.userName === "string" ? d.userName : "",
                    userEmail: typeof d?.userEmail === "string" ? d.userEmail : "",
                    userId: typeof d?.userId === "string" ? d.userId : null,
                    submittedAt: d?.submittedAt && typeof (d.submittedAt as Timestamp).toDate === "function"
                    ? (d.submittedAt as Timestamp).toDate().toISOString()
                    : null,
                    removedFieldIds,
                });
            });
            cursor = snap.docs[snap.docs.length - 1].id;
        }
        // Sort submissions in memory by submittedAt descending
        submissions.sort((a, b) => {
            const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
            const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
            return bTime - aTime;
        });

        // Search mirrors the registrations page filter: name, email or any answer text.
        const filtered = search
            ? submissions.filter(s =>
                (s.userName || "").toLowerCase().includes(search) ||
                (s.userEmail || "").toLowerCase().includes(search) ||
                Object.values(s.answers).some(v => {
                    const t = Array.isArray(v) ? v.join(" ") : typeof v === "object" ? "" : String(v);
                    return t.toLowerCase().includes(search);
                })
            )
            : submissions;

        const payload: ExportPayload = {
            form: {
                id,
                title: fd?.title ?? "Form",
                description: fd?.description ?? "",
                status: fd?.status ?? "closed",
                fields: (fd?.fields ?? []) as never,
                createdAt: iso(fd?.createdAt),
                updatedAt: iso(fd?.updatedAt),
                opensAt: iso(fd?.opensAt),
                closesAt: iso(fd?.closesAt),
            },
            submissions: filtered,
        };

        const { body: fileBody, contentType, ext } = await buildExport(format, payload);
        const filename = exportFilename(payload.form.title, ext);

        await logServerActivity(ctx.uid, ctx.name, "form.export", {
            formId: id,
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
        console.error("Form export error:", err);
        return NextResponse.json({ error: "Could not generate the export. Please try again." }, { status: 500 });
    }
}
