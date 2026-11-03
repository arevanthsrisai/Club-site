/**
 * Client services for the standalone Forms system.
 *
 * Reads go through Firestore's rules (published forms are public; drafts and
 * submissions are admin-visible). Privileged writes go through the
 * server-authorized API routes (/api/admin/forms/*) and public submissions
 * through /api/forms/submit.
 */
import {
    collection, doc, limit, onSnapshot, orderBy, query, where,
    type DocumentData, type FirestoreError, type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getAuthHeaders } from "@/lib/authHeaders";
import type { Form, FormSubmission, FormStatus } from "@/types/forms";

// ── Firestore converters/readers ────────────────────────────────────────────

function iso(value: unknown): string | null {
    if (value && typeof value === "object" && "toDate" in (value as object)) {
        try { return (value as { toDate(): Date }).toDate().toISOString(); } catch { return null; }
    }
    return null;
}

function formFromDoc(snap: QueryDocumentSnapshot<DocumentData>): Form {
    const d = snap.data();
    return {
        id: snap.id,
        eventId: typeof d.eventId === "string" ? d.eventId : null,
        title: typeof d.title === "string" ? d.title : "",
        description: typeof d.description === "string" ? d.description : "",
        status: (["draft", "published", "closed"].includes(d.status) ? d.status : "draft") as FormStatus,
        opensAt: iso(d.opensAt),
        closesAt: iso(d.closesAt),
        fields: Array.isArray(d.fields)
            ? d.fields.filter(f => f && typeof f.id === "string" && typeof f.label === "string" && typeof f.type === "string")
            : [],
        createdAt: iso(d.createdAt),
        updatedAt: iso(d.updatedAt),
        createdBy: typeof d.createdBy === "string" ? d.createdBy : null,
        updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null,
        submissionCount: typeof d.submissionCount === "number" ? d.submissionCount : 0,
    };
}

function submissionFromDoc(snap: QueryDocumentSnapshot<DocumentData>): FormSubmission {
    const d = snap.data();
    return {
        id: snap.id,
        formId: typeof d.formId === "string" ? d.formId : "",
        eventId: typeof d.eventId === "string" ? d.eventId : "",
        answers: (typeof d.answers === "object" && d.answers ? d.answers : {}) as FormSubmission["answers"],
        userName: typeof d.userName === "string" ? d.userName : "",
        userEmail: typeof d.userEmail === "string" ? d.userEmail : "",
        userId: typeof d.userId === "string" ? d.userId : null,
        submittedAt: iso(d.submittedAt),
    };
}

// ── Subscriptions ───────────────────────────────────────────────────────────

/** Live list of every form (admin page). Newest activity first. */
export function subscribeToForms(
    onUpdate: (forms: Form[]) => void,
    onError?: (error: FirestoreError) => void
): () => void {
    const q = query(collection(db, "forms"), orderBy("updatedAt", "desc"), limit(200));
    return onSnapshot(q,
        snap => onUpdate(snap.docs.map(formFromDoc)),
        err => { console.warn("subscribeToForms error:", err); onError?.(err); }
    );
}

/** Public listing at /forms — only published forms are readable by the rules. */
export function subscribeToPublicForms(
    onUpdate: (forms: Form[]) => void,
    onError?: (error: FirestoreError) => void
): () => void {
    const q = query(collection(db, "forms"), where("status", "==", "published"), orderBy("createdAt", "desc"), limit(100));
    return onSnapshot(q,
        snap => onUpdate(snap.docs.map(formFromDoc)),
        err => { console.warn("subscribeToPublicForms error:", err); onError?.(err); }
    );
}

/** Live single form. `onUpdate(null)` covers drafts the visitor cannot read and deleted docs. */
export function subscribeToForm(
    formId: string,
    onUpdate: (form: Form | null, missing: boolean) => void,
    onError?: (error: FirestoreError) => void
): () => void {
    return onSnapshot(doc(db, "forms", formId),
        snap => onUpdate(snap.exists() ? formFromDoc(snap as QueryDocumentSnapshot<DocumentData>) : null, !snap.exists()),
        err => { console.warn("subscribeToForm error:", err); onError?.(err); }
    );
}

/** Live paginated submissions page for one form (admin registrations view). */
export function subscribeToFormSubmissions(
    formId: string,
    pageSize: number,
    onUpdate: (subs: FormSubmission[]) => void,
    onError?: (error: FirestoreError) => void
): () => void {
    const q = query(
        collection(db, "form_submissions"),
        where("formId", "==", formId),
        orderBy("submittedAt", "desc"),
        limit(pageSize)
    );
    return onSnapshot(q,
        snap => onUpdate(snap.docs.map(submissionFromDoc)),
        err => { console.warn("subscribeToFormSubmissions error:", err); onError?.(err); }
    );
}

// ── Server-authorized admin operations ─────────────────────────────────────

async function postJson<T>(url: string, body: unknown): Promise<T> {
    const headers = await getAuthHeaders();
    if (!headers) throw new ApiError("Sign in required.", 401, "UNAUTHENTICATED");
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        throw new ApiError(payload?.error || "Request failed.", res.status, payload?.code);
    }
    return payload as T;
}

export class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/** Create or save a form through the server route. Returns the doc id. */
export async function saveForm(payload: unknown, id?: string | null): Promise<{ id: string }> {
    return postJson<{ id: string }>("/api/admin/forms/save", { id: id ?? null, form: payload });
}

/** Delete a form and its submissions (server route, audited). */
export async function deleteForm(id: string): Promise<{ deletedSubmissions: number }> {
    return postJson<{ deletedSubmissions: number }>("/api/admin/forms/delete", { id });
}

/** Downloads a registration export for one form. Throws ApiError on failure. */
export async function exportFormRegistrations(
    form: Form,
    format: string,
    search?: string
): Promise<void> {
    const headers = await getAuthHeaders();
    if (!headers) throw new ApiError("Sign in required.", 401, "UNAUTHENTICATED");
    const res = await fetch("/api/admin/forms/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ id: form.id, format, search: search || "" }),
    });
    if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new ApiError(payload?.error || "Export failed.", res.status);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="(.*?)"/.exec(disposition);
    const filename = match?.[1] ?? `registrations.${format}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** Public submission through the API route. */
export async function submitFormAnswers(formId: string, answers: Record<string, unknown>): Promise<{ ok: true; submissionId: string }> {
    const res = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, answers }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        const err = new ApiError(
            payload?.error || "Could not submit the form.",
            res.status,
            payload?.code
        ) as ApiError & { fieldErrors?: Record<string, string> };
        if (payload?.fieldErrors) err.fieldErrors = payload.fieldErrors;
        throw err;
    }
    return payload as { ok: true; submissionId: string };
}
