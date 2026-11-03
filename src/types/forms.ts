/**
 * Types for the standalone Forms system (draft → published → closed),
 * with per-form custom fields and generic submissions.
 *
 * These live alongside the existing event-registration types; event data
 * is untouched by this system.
 */

export const FORM_FIELDS = ["shortText", "longText", "email", "phone", "number", "date", "singleChoice", "multiChoice", "dropdown", "checkbox"] as const;
export type FormFieldType = (typeof FORM_FIELDS)[number];

export type FormStatus = "draft" | "published" | "closed";

export interface FormField {
    id: string;
    type: FormFieldType;
    label: string;
    helpText?: string;
    required: boolean;
    placeholder?: string;
    /** Choice-based types only */
    options?: string[];
    /** number type only */
    min?: number | null;
    max?: number | null;
    defaultValue?: string | number | boolean | string[] | null;
}

export interface Form {
    id: string;
    title: string;
    description: string;
    status: FormStatus;
    /** The event this form belongs to. Every form must be associated with an event. */
    eventId: string | null;
    /** ISO 8601 strings (or null). UI types show a local picker. */
    opensAt: string | null;
    closesAt: string | null;
    fields: FormField[];
    createdAt: string | null;
    updatedAt: string | null;
    createdBy: string | null;
    updatedBy: string | null;
    /** Maintained by the server on submission; rechecked on the registrations page. */
    submissionCount: number;
}

export interface FormSubmission {
    id: string;
    formId: string;
    /** The event this submission belongs to (denormalised from the parent form for fast event-scoped queries). */
    eventId: string | null;
    /** Field id → answer. Removed fields keep their historical answers. */
    answers: Record<string, string | number | boolean | string[]>;
    userName: string;
    userEmail: string;
    /** Present only when the submitter was signed in. */
    userId?: string | null;
    submittedAt: string | null;
}

export type FormAnswerValue = NonNullable<FormSubmission["answers"][string]>;

export interface ExportFormat {
    value: string;
    label: string;
    ext: string;
}

export const EXPORT_EXTENSIONS: Record<string, string> = {
    csv: "csv",
    xlsx: "xlsx",
    pdf: "pdf",
    docx: "docx",
    json: "json",
    txt: "txt",
    html: "html",
};
