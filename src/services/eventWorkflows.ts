/**
 * Client service for event workflow operations (Restart/Reset) and multi-format exports.
 */
import { getAuthHeaders } from "@/lib/authHeaders";

export type WorkflowType = "registration" | "attendance" | "feedback";
export type WorkflowAction = "restart" | "stop" | "reset";
export type ExportFormatId = "csv" | "xlsx" | "pdf" | "docx" | "json" | "txt" | "html";

export class WorkflowError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

/** Restart, stop, or reset a workflow for the given event. */
export async function executeWorkflowAction(
    eventId: string,
    workflow: WorkflowType,
    action: WorkflowAction
): Promise<{ ok: true; message: string }> {
    const headers = await getAuthHeaders();
    if (!headers) throw new WorkflowError("Sign in required.", 401);

    const res = await fetch("/api/admin/events/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ eventId, workflow, action }),
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        throw new WorkflowError(payload?.error || "Action failed.", res.status);
    }
    return payload as { ok: true; message: string };
}

/** Export event workflow data in the selected format and trigger a download. */
export async function exportEventWorkflow(
    eventId: string,
    workflow: WorkflowType,
    format: ExportFormatId,
    search?: string
): Promise<void> {
    const headers = await getAuthHeaders();
    if (!headers) throw new WorkflowError("Sign in required.", 401);

    const res = await fetch("/api/admin/events/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ eventId, workflow, format, search: search || "" }),
    });

    if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new WorkflowError(payload?.error || "Export failed.", res.status);
    }

    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="?(.*?)"?(?:;|$)/.exec(disposition);
    const filename = match?.[1] ?? `${workflow}.${format}`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** Export format metadata for the dropdown picker. */
export const EXPORT_FORMATS: { id: ExportFormatId; label: string }[] = [
    { id: "csv", label: "CSV" },
    { id: "xlsx", label: "Excel" },
    { id: "pdf", label: "PDF" },
    { id: "docx", label: "Word" },
    { id: "json", label: "JSON" },
    { id: "txt", label: "Plain text" },
    { id: "html", label: "HTML" },
];
