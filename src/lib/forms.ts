/**
 * Pure domain logic for the Forms system. No Firestore imports — everything
 * here is unit-testable (tests/forms.test.mjs) and shared by the admin UI,
 * the public renderer, the API routes and the export generators.
 */
import { FORM_FIELDS } from "../types/forms.ts";
import type { Form, FormAnswerValue, FormField, FormFieldType, FormStatus } from "../types/forms.ts";

/** Field/user-text limits. The UI, builder and API all validate against these. */
export const FORM_LIMITS = {
    title: { min: 1, max: 120 },
    description: { max: 2000 },
    fieldLabel: { min: 1, max: 200 },
    helpText: { max: 500 },
    placeholder: { max: 200 },
    optionText: { max: 100 },
    minOptions: 2,
    maxOptions: 26,
    maxFields: 50,
    answerLongText: { max: 5000 },
    answerShortText: { max: 500 },
} as const;

export const FORM_FIELD_META: Record<FormFieldType, { label: string; needsOptions: boolean; needsMinMax: boolean; hasDefault: boolean }> = {
    shortText: { label: "Short text", needsOptions: false, needsMinMax: false, hasDefault: true },
    longText: { label: "Long text", needsOptions: false, needsMinMax: false, hasDefault: true },
    email: { label: "Email", needsOptions: false, needsMinMax: false, hasDefault: true },
    phone: { label: "Phone number", needsOptions: false, needsMinMax: false, hasDefault: true },
    number: { label: "Number", needsOptions: false, needsMinMax: true, hasDefault: true },
    date: { label: "Date", needsOptions: false, needsMinMax: false, hasDefault: true },
    singleChoice: { label: "Single choice", needsOptions: true, needsMinMax: false, hasDefault: true },
    multiChoice: { label: "Multiple choice", needsOptions: true, needsMinMax: false, hasDefault: true },
    dropdown: { label: "Dropdown", needsOptions: true, needsMinMax: false, hasDefault: true },
    checkbox: { label: "Checkbox / consent", needsOptions: false, needsMinMax: false, hasDefault: true },
};

export const FORM_STATUSES: FormStatus[] = ["draft", "published", "closed"];
export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
    draft: "Draft",
    published: "Published",
    closed: "Closed",
};

export function isFormFieldType(t: unknown): t is FormFieldType {
    return typeof t === "string" && (FORM_FIELDS as readonly string[]).includes(t);
}

export function isFormStatus(t: unknown): t is FormStatus {
    return t === "draft" || t === "published" || t === "closed";
}

export function newFieldId(): string {
    // crypto.randomUUID is available in browsers and Node 19+.
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return `fid_${globalThis.crypto.randomUUID().replace(/-/g, "_")}`;
    }
    return `fid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function emptyField(type: FormFieldType): FormField {
    return {
        id: newFieldId(),
        type,
        label: "",
        required: false,
        helpText: "",
        placeholder: "",
        options: FORM_FIELD_META[type].needsOptions ? ["", ""] : undefined,
        min: type === "number" ? null : undefined,
        max: type === "number" ? null : undefined,
        defaultValue: null,
    };
}

// ── Field normalization / validation ────────────────────────────────────────

function cleanText(v: unknown, max: number): string | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    if (!s) return undefined;
    return s.length > max ? undefined : s;
}

function normalizeField(raw: unknown, index: number): { field: FormField } | { error: string } {
    if (typeof raw !== "object" || raw === null) return { error: `Field ${index + 1} is not valid.` };
    const r = raw as Record<string, unknown>;
    if (!isFormFieldType(r.type)) return { error: `Field ${index + 1} has an unsupported type.` };
    const meta = FORM_FIELD_META[r.type];

    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (label.length < FORM_LIMITS.fieldLabel.min) return { error: `Field ${index + 1}: add a label.` };
    if (label.length > FORM_LIMITS.fieldLabel.max) return { error: `Field ${index + 1}: labels are limited to ${FORM_LIMITS.fieldLabel.max} characters.` };

    const field: FormField = {
        id: typeof r.id === "string" && r.id.length > 0 && r.id.length <= 64 ? r.id : newFieldId(),
        type: r.type,
        label,
        required: r.required === true,
        helpText: cleanText(r.helpText, FORM_LIMITS.helpText.max),
        placeholder: cleanText(r.placeholder, FORM_LIMITS.placeholder.max),
    };

    if (meta.needsOptions) {
        const opts = Array.isArray(r.options) ? r.options : [];
        const cleaned: string[] = [];
        for (const o of opts) {
            if (typeof o !== "string") continue;
            const s = o.trim();
            if (!s) continue;
            if (s.length > FORM_LIMITS.optionText.max) return { error: `Field "${label}": options are limited to ${FORM_LIMITS.optionText.max} characters.` };
            if (!cleaned.some(c => c.toLowerCase() === s.toLowerCase())) cleaned.push(s);
        }
        if (cleaned.length < FORM_LIMITS.minOptions) return { error: `Field "${label}": choice fields need at least ${FORM_LIMITS.minOptions} options.` };
        if (cleaned.length > FORM_LIMITS.maxOptions) return { error: `Field "${label}": choice fields support up to ${FORM_LIMITS.maxOptions} options.` };
        field.options = cleaned;
    }

    if (meta.needsMinMax) {
        if (r.min !== undefined && r.min !== null && r.min !== "") {
            if (typeof r.min !== "number" || !Number.isFinite(r.min)) return { error: `Field "${label}": minimum must be a number.` };
            field.min = r.min;
        }
        if (r.max !== undefined && r.max !== null && r.max !== "") {
            if (typeof r.max !== "number" || !Number.isFinite(r.max)) return { error: `Field "${label}": maximum must be a number.` };
            field.max = r.max;
        }
        if (field.min !== undefined && field.max !== undefined && field.min !== null && field.max !== null && field.min > field.max) {
            return { error: `Field "${label}": minimum cannot be greater than the maximum.` };
        }
    }

    if (meta.hasDefault && r.defaultValue !== undefined && r.defaultValue !== null && r.defaultValue !== "") {
        const dv = r.defaultValue;
        if (r.type === "multiChoice") {
            if (!Array.isArray(dv) || !dv.every(x => typeof x === "string" && field.options?.includes(x))) {
                return { error: `Field "${label}": the default must be one of the options.` };
            }
            field.defaultValue = dv as string[];
        } else if (r.type === "checkbox") {
            if (dv !== true && dv !== false) return { error: `Field "${label}": the default must be checked or unchecked.` };
            field.defaultValue = dv;
        } else if (r.type === "number") {
            const n = typeof dv === "string" ? Number(dv.trim()) : dv;
            if (typeof n !== "number" || !Number.isFinite(n)) return { error: `Field "${label}": the default must be a number.` };
            if (field.min !== undefined && field.min !== null && n < field.min) return { error: `Field "${label}": the default is below this field's minimum.` };
            if (field.max !== undefined && field.max !== null && n > field.max) return { error: `Field "${label}": the default is above this field's maximum.` };
            field.defaultValue = n;
        } else if (r.type === "singleChoice" || r.type === "dropdown") {
            if (typeof dv !== "string" || !field.options?.includes(dv)) return { error: `Field "${label}": the default must be one of the options.` };
            field.defaultValue = dv;
        } else if (r.type === "date") {
            if (typeof dv !== "string" || !isValidISODate(dv)) return { error: `Field "${label}": the default date is not a valid date (YYYY-MM-DD).` };
            field.defaultValue = dv;
        } else {
            if (typeof dv !== "string" || !dv.trim()) return { error: `Field "${label}": the default must be text.` };
            if (dv.trim().length > (r.type === "longText" ? FORM_LIMITS.answerLongText.max : FORM_LIMITS.answerShortText.max)) {
                return { error: `Field "${label}": the default is too long.` };
            }
            field.defaultValue = dv.trim();
        }
    }

    return { field };
}

/** Validate + normalize an admin-authored form payload. Returns issues to show in the builder. */
export function normalizeFormPayload(
    payload: unknown
): { ok: true; value: NormalizedFormInput } | { ok: false; error: string } {
    if (typeof payload !== "object" || payload === null) return { ok: false, error: "The form payload is not valid." };
    const p = payload as Record<string, unknown>;

    const title = typeof p.title === "string" ? p.title.trim() : "";
    if (title.length < FORM_LIMITS.title.min) return { ok: false, error: "Give the form a title." };
    if (title.length > FORM_LIMITS.title.max) return { ok: false, error: `Titles are limited to ${FORM_LIMITS.title.max} characters.` };

    let description = "";
    if (p.description !== undefined && p.description !== null) {
        if (typeof p.description !== "string") return { ok: false, error: "The description must be text." };
        description = p.description.trim();
        if (description.length > FORM_LIMITS.description.max) return { ok: false, error: `Descriptions are limited to ${FORM_LIMITS.description.max} characters.` };
    }

    const status: FormStatus = isFormStatus(p.status) ? p.status : "draft";

    const eventId = typeof p.eventId === "string" ? p.eventId.trim() : "";
    if (eventId.length === 0) return { ok: false, error: "The form must belong to an event. Select an event." };

    const opensAt = p.opensAt === undefined || p.opensAt === null || p.opensAt === "" ? null : parseInstant(p.opensAt);
    if (p.opensAt != null && p.opensAt !== "" && opensAt === null) return { ok: false, error: "The opening date/time is not a valid date." };
    const closesAt = p.closesAt === undefined || p.closesAt === null || p.closesAt === "" ? null : parseInstant(p.closesAt);
    if (p.closesAt != null && p.closesAt !== "" && closesAt === null) return { ok: false, error: "The closing date/time is not a valid date." };
    if (opensAt && closesAt && opensAt >= closesAt) return { ok: false, error: "The opening time must be before the closing time." };

    if (!Array.isArray(p.fields)) return { ok: false, error: "The form fields are not valid." };
    if (p.fields.length > FORM_LIMITS.maxFields) return { ok: false, error: `Forms support up to ${FORM_LIMITS.maxFields} fields.` };

    const fields: FormField[] = [];
    const seenIds = new Set<string>();
    for (let i = 0; i < p.fields.length; i++) {
        const res = normalizeField(p.fields[i], i);
        if ("error" in res) return { ok: false, error: res.error };
        if (seenIds.has(res.field.id)) return { ok: false, error: `Field "${res.field.label}": duplicate field id.` };
        seenIds.add(res.field.id);
        fields.push(res.field);
    }

    if (status === "published" && fields.length === 0) {
        return { ok: false, error: "Add at least one field before publishing the form." };
    }

    return {
        ok: true,
        value: { eventId, title, description, status, opensAt, closesAt, fields },
    };
}

export interface NormalizedFormInput {
    eventId: string;
    title: string;
    description: string;
    status: FormStatus;
    opensAt: Date | null;
    closesAt: Date | null;
    fields: FormField[];
}

function parseInstant(v: unknown): Date | null {
    if (typeof v !== "string") return null;
    // Accept both full ISO strings and `datetime-local` payloads.
    const s = v.includes("T") ? v : `${v}T00:00:00`;

    // Values from a `datetime-local` input carry no offset; interpret them as
    // the server's local time (the admin's browser and server share a TZ in
    // this deployment, and both the picker and this parser use local time).
    const d = s.endsWith("Z") || /[+-]\d\d:\d\d$/.test(s) ? new Date(s) : new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function isValidISODate(s: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ── Availability ────────────────────────────────────────────────────────────

export type AvailabilityReason = "draft" | "closed-status" | "not-yet-open" | "deadline-passed" | "open";

export function computeAvailability(form: Pick<Form, "status" | "opensAt" | "closesAt">, now: Date = new Date()): AvailabilityReason {
    if (form.status === "draft") return "draft";
    if (form.status === "closed") return "closed-status";
    if (form.opensAt && new Date(form.opensAt) > now) return "not-yet-open";
    if (form.closesAt && new Date(form.closesAt) <= now) return "deadline-passed";
    return "open";
}

export const AVAILABILITY_MESSAGE: Record<AvailabilityReason, string> = {
    draft: "This form is not available yet.",
    "closed-status": "This form is closed and no longer accepting submissions.",
    "not-yet-open": "This form has not opened yet.",
    "deadline-passed": "This form's deadline has passed.",
    open: "",
};

// ── Submission validation ───────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type SubmissionErrors = Record<string, string>;

/** Validate answers against the form's field definitions. Field ids are the only keying. */
export function validateSubmission(
    form: Pick<Form, "fields">,
    answers: unknown
): SubmissionErrors {
    const errors: SubmissionErrors = {};
    const given = (typeof answers === "object" && answers !== null && answers !== undefined) ? answers as Record<string, unknown> : {};

    for (const field of form.fields) {
        const raw = given[field.id];
        const missing = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);

        if (field.type === "checkbox") {
            if (typeof raw === "boolean") {
                if (field.required && raw !== true) errors[field.id] = "This box must be checked.";
            } else if (missing) {
                if (field.required) errors[field.id] = "This box must be checked.";
            } else {
                errors[field.id] = "Answer must be checked or unchecked.";
            }
            continue;
        }

        if (missing) {
            if (field.required) errors[field.id] = "This field is required.";
            continue;
        }

        switch (field.type) {
            case "shortText":
            case "longText": {
                if (typeof raw !== "string") { errors[field.id] = "Answer must be text."; break; }
                const limit = field.type === "longText" ? FORM_LIMITS.answerLongText.max : FORM_LIMITS.answerShortText.max;
                if (raw.length > limit) errors[field.id] = `Limited to ${limit} characters.`;
                break;
            }
            case "email": {
                if (typeof raw !== "string" || raw.length > 200 || !EMAIL_RE.test(raw.trim())) {
                    errors[field.id] = "Enter a valid email address.";
                }
                break;
            }
            case "phone": {
                if (typeof raw !== "string") { errors[field.id] = "Enter a valid phone number."; break; }
                const digits = raw.replace(/[\s\-()]/g, "").replace(/^\+/, "");
                if (!/^\d{7,15}$/.test(digits)) errors[field.id] = "Enter a valid phone number (7–15 digits).";
                break;
            }
            case "number": {
                const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
                if (!Number.isFinite(n)) { errors[field.id] = "Enter a number."; break; }
                if (field.min != null && n < field.min) errors[field.id] = `Must be at least ${field.min}.`;
                if (field.max != null && n > field.max) errors[field.id] = `Must be at most ${field.max}.`;
                if (Math.abs(n) > Number.MAX_SAFE_INTEGER) errors[field.id] = "Number is too large.";
                break;
            }
            case "date": {
                if (typeof raw !== "string" || !isValidISODate(raw)) errors[field.id] = "Enter a valid date.";
                break;
            }
            case "singleChoice":
            case "dropdown": {
                if (typeof raw !== "string" || !field.options?.includes(raw)) errors[field.id] = "Choose one of the listed options.";
                break;
            }
            case "multiChoice": {
                if (!Array.isArray(raw) || !raw.every(x => typeof x === "string")) {
                    errors[field.id] = "Choose from the listed options.";
                    break;
                }
                if (raw.some(x => !field.options?.includes(x as string))) errors[field.id] = "Choose from the listed options.";
                break;
            }
        }
    }
    return errors;
}

/** Coerce validated answers into a JSON-safe persisted shape (numbers stay numbers, etc.). */
export function persistableAnswers(fieldList: FormField[], given: Record<string, unknown>): Record<string, FormAnswerValue> {
    const out: Record<string, FormAnswerValue> = {};
    for (const field of fieldList) {
        const raw = given[field.id];
        if (raw === undefined || raw === null || raw === "") continue;
        if (field.type === "checkbox") {
            if (typeof raw === "boolean") out[field.id] = raw;
            continue;
        }
        if (field.type === "multiChoice") {
            if (Array.isArray(raw) && raw.length > 0) out[field.id] = (raw as unknown[]).filter((x): x is string => typeof x === "string");
            continue;
        }
        if (field.type === "number") {
            const n = typeof raw === "number" ? raw : Number(String(raw).trim());
            if (Number.isFinite(n)) out[field.id] = n;
            continue;
        }
        if (typeof raw === "string" && raw.trim() !== "") out[field.id] = raw.trim();
    }
    return out;
}

// ── Label resolution / display ──────────────────────────────────────────────

export interface ResolvedFieldLabel {
    label: string;
    /** True when a historically submitted answer references a field that no longer exists. */
    removed: boolean;
}

export function resolveFieldLabel(form: Pick<Form, "fields">, fieldId: string): ResolvedFieldLabel {
    const field = form.fields.find(f => f.id === fieldId);
    if (field) return { label: field.label, removed: false };
    return { label: "Removed field", removed: true };
}

/** Human-readable string for an answer (display in admin views and export builders). */
export function formatAnswerValue(field: FormField | undefined, value: FormAnswerValue | undefined): string {
    if (value === undefined || value === null) return "";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (field?.type === "date" && typeof value === "string") {
        const [y, m, d] = value.split("-");
        return y && m && d ? `${d}/${m}/${y}` : value; // keep it unambiguous day/month/year
    }
    return String(value);
}

// ── Export row building (shared by every format) ────────────────────────────

export interface ExportColumn {
    key: string;
    header: string;
}

export interface ExportRow {
    submittedAt: string | null;
    userName: string;
    userEmail: string;
    signedIn: boolean;
    /** column key → display string */
    cells: Record<string, string>;
}

/** Columns: identity info first, then one column per field (removed fields included). */
export function buildExportColumns(form: Pick<Form, "fields">): ExportColumn[] {
    const cols: ExportColumn[] = [
        { key: "__submittedAt", header: "Submitted at" },
        { key: "__name", header: "Name" },
        { key: "__email", header: "Email" },
    ];
    for (const f of form.fields) cols.push({ key: f.id, header: f.label });
    return cols;
}

export interface ExportSubmission {
    id: string;
    answers: Record<string, FormAnswerValue>;
    userName: string;
    userEmail: string;
    userId?: string | null;
    submittedAt: string | null;
    /** Field ids that no longer exist on the form but carry answers. */
    removedFieldIds?: string[];
}

export function buildExportRows(
    form: Pick<Form, "fields">,
    submissions: ExportSubmission[],
    formatSubmittedAt: (iso: string | null) => string
): ExportRow[] {
    return submissions.map(s => {
        const cells: Record<string, string> = {};
        for (const field of form.fields) {
            cells[field.id] = formatAnswerValue(form.fields.find(f => f.id === field.id), s.answers[field.id]);
        }
        // Answers for fields removed since submission are appended as pseudo-columns so data is never silently discarded.
        for (const id of s.removedFieldIds ?? []) {
            cells[`removed_${id}`] = formatAnswerValue(undefined, s.answers[id]);
        }
        return {
            submittedAt: s.submittedAt ? formatSubmittedAt(s.submittedAt) : "",
            userName: s.userName || "—",
            userEmail: s.userEmail || "—",
            signedIn: Boolean(s.userId),
            cells,
        };
    });
}

export function estimateAnswerColumns(form: Pick<Form, "fields">, submissions: ExportSubmission[]): ExportColumn[] {
    const cols = buildExportColumns(form);
    const seen = new Set(cols.map(c => c.key));
    const extra: ExportColumn[] = [];
    for (const s of submissions) {
        for (const id of s.removedFieldIds ?? []) {
            if (!seen.has(id)) {
                seen.add(id);
                const { label } = resolveFieldLabel({ fields: [] } as Pick<Form, "fields">, id);
                extra.push({ key: `removed_${id}`, header: `${label} (removed)` });
            }
        }
    }
    return [...cols, ...extra];
}

// ── Filename helper ─────────────────────────────────────────────────────────

export function slugifyFormTitle(title: string): string {
    const slug = title.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
    return (slug || "form").slice(0, 60);
}
