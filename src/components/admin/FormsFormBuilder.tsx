"use client";

/**
 * Form builder shared by /admin/forms/new and /admin/forms/[id]/edit.
 *
 * - Details (title, description, status, open/close windows)
 * - Field editor: add, edit, reorder (drag + buttons), duplicate, remove
 * - Live preview rendered through the same component the public page uses
 * - Unsaved-changes guard (browser-level + explicit "Leave?" dialog)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FormRenderer, { type RendererValues } from "@/components/forms/FormRenderer";
import { emptyField, normalizeFormPayload, validateSubmission, FORM_FIELD_META } from "@/lib/forms";
import type { Form, FormField as FormFormField, FormFieldType, FormStatus } from "@/types/forms";
import { saveForm, ApiError } from "@/services/forms";
import { getEvents } from "@/services/events";
import { useToast } from "@/components/ui/Toast";
import {
    ArrowLeft, ArrowDown, ArrowUp, Copy, GripVertical, Lock, Eye, EyeOff, Pencil, Plus,
    Save, Trash2, Type, AlignLeft, AtSign, Phone, Hash, CalendarDays,
    CircleDot, ListChecks, ChevronDown, SquareCheck, AlertTriangle,
} from "lucide-react";

const TYPE_LIST: { type: FormFieldType; icon: typeof Type }[] = [
    { type: "shortText", icon: Type },
    { type: "longText", icon: AlignLeft },
    { type: "email", icon: AtSign },
    { type: "phone", icon: Phone },
    { type: "number", icon: Hash },
    { type: "date", icon: CalendarDays },
    { type: "singleChoice", icon: CircleDot },
    { type: "multiChoice", icon: ListChecks },
    { type: "dropdown", icon: ChevronDown },
    { type: "checkbox", icon: SquareCheck },
];
const TYPE_ICON: Record<FormFieldType, typeof Type> = Object.fromEntries(
    TYPE_LIST.map(t => [t.type, t.icon])
) as Record<FormFieldType, typeof Type>;

interface BuilderDraft {
    eventId: string;
    title: string;
    description: string;
    status: FormStatus;
    opensAt: string | null;
    closesAt: string | null;
    fields: FormFormField[];
}

export function draftFromForm(form: Form | null): BuilderDraft {
    return {
        eventId: form?.eventId ?? "",
        title: form?.title ?? "",
        description: form?.description ?? "",
        status: form?.status ?? "draft",
        opensAt: form?.opensAt ?? null,
        closesAt: form?.closesAt ?? null,
        fields: form?.fields ?? [],
    };
}

// datetime-local ⇄ absolute ISO helpers (absolute instants, no day-shift)
function isoToLocalInput(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localInputToIso(v: string): string | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function FormBuilder({ initial }: { initial: { id: string | null; draft: BuilderDraft } }) {
    const router = useRouter();
    const toast = useToast();
    const [id, setId] = useState<string | null>(initial.id);
    const [draft, setDraft] = useState<BuilderDraft>(initial.draft);
    const [initialJson, setInitialJson] = useState(() => JSON.stringify(initial.draft));
    const [showPreview, setShowPreview] = useState(false);
    const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
    const [eventsLoaded, setEventsLoaded] = useState(false);

    // Load events for the event selector.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const allEvents = await getEvents();
                if (!cancelled) setEvents(allEvents.map(e => ({ id: e.id, title: e.title })));
            } catch (e) {
                console.warn("Could not load events for form builder:", e);
            } finally {
                if (!cancelled) setEventsLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, []);
    const [previewValues, setPreviewValues] = useState<RendererValues>({});
    const [previewTouched, setPreviewTouched] = useState<Record<string, string>>({});
    const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [clientError, setClientError] = useState("");
    const [leaveConfirm, setLeaveConfirm] = useState(false);
    const dragIndex = useRef<number | null>(null);

    const dirty = useMemo(() => JSON.stringify(draft) !== initialJson, [draft, initialJson]);

    // Warn before closing/refreshing the tab with unsaved work.
    useEffect(() => {
        if (!dirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [dirty]);

    const update = (patch: Partial<BuilderDraft>) => setDraft(d => ({ ...d, ...patch }));

    const moveField = (index: number, dir: -1 | 1) => {
        const target = index + dir;
        if (target < 0 || target >= draft.fields.length) return;
        const fields = [...draft.fields];
        [fields[index], fields[target]] = [fields[target], fields[index]];
        update({ fields });
    };

    const removeField = (index: number) => {
        const field = draft.fields[index];
        if (!confirm(`Remove field "${field.label || "Unnamed"}"? Existing responses for it stay in history but will no longer show new answers.`)) return;
        const fields = draft.fields.filter((_, i) => i !== index);
        update({ fields });
    };

    const duplicateField = (index: number) => {
        const src = draft.fields[index];
        const copy = { ...emptyField(src.type), ...structuredClone(src), id: emptyField(src.type).id, label: src.label ? `${src.label} (copy)` : "" };
        const fields = [...draft.fields];
        fields.splice(index + 1, 0, copy);
        update({ fields });
        setExpandedFieldId(copy.id);
    };

    const addField = (type: FormFieldType) => {
        const field = emptyField(type);
        update({ fields: [...draft.fields, field] });
        setExpandedFieldId(field.id);
    };

    const patchField = (fieldId: string, patch: Partial<FormFormField>) => {
        update({ fields: draft.fields.map(f => (f.id === fieldId ? { ...f, ...patch } : f)) });
    };

    const save = async () => {
        const result = normalizeFormPayload(draft);
        if (!result.ok) {
            setClientError(result.error);
            return;
        }
        // Opening in the past is fine (opens immediately); only the close window matters.
        setClientError("");
        setSaving(true);
        try {
            const saved = await saveForm(result.value, id); // { ok, id } — server stores the normalized payload
            // The edit route re-hydrates from Firestore after router.replace, but keep
            // the dirty guard accurate in case navigation is brief.
            const clean: BuilderDraft = {
                eventId: result.value.eventId,
                title: result.value.title,
                description: result.value.description,
                status: result.value.status,
                opensAt: result.value.opensAt?.toISOString() ?? null,
                closesAt: result.value.closesAt?.toISOString() ?? null,
                fields: result.value.fields as FormFormField[],
            };
            setDraft(clean);
            setInitialJson(JSON.stringify(clean));
            if (!id) {
                setId(saved.id);
                toast.success("Form created as a draft. Publish it when it is ready.");
                router.replace(`/admin/forms/${saved.id}/edit`);
            } else {
                toast.success("Form saved.");
            }
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not save the form.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        aria-label="Go back"
                        className={`h-10 w-10 shrink-0 rounded-full border border-white/10 hover:bg-white/10 text-white transition-colors grid place-items-center ${dirty ? "" : ""}`}
                        onClick={() => (dirty ? setLeaveConfirm(true) : window.history.back())}
                    >
                        <ArrowLeft size={18} aria-hidden="true" />
                    </button>
                    <h1 className="text-2xl font-bold text-white">
                        {id ? "Edit form" : "New form"}
                        {dirty && <span title="Unsaved changes" className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-400 align-middle" aria-label="Unsaved changes" />}
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowPreview(p => !p)}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 transition-colors inline-flex items-center gap-1.5"
                        aria-pressed={showPreview}
                    >
                        {showPreview ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                        {showPreview ? "Hide preview" : "Preview"}
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={saving}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                        <Save size={14} aria-hidden="true" /> {saving ? "Saving…" : id ? "Save changes" : "Create form"}
                    </button>
                </div>
            </div>

            {clientError && (
                <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0" aria-hidden="true" /> {clientError}
                </div>
            )}

            <div className={showPreview ? "grid gap-6 lg:grid-cols-2" : ""}>
                {/* ── Editor column ── */}
                <div className="space-y-5">
                    {/* Details */}
                    <section className="rounded-2xl border border-white/10 bg-black/30 p-5">
                        <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-4">Details</h2>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="fb-event" className="block text-sm font-semibold text-gray-200 mb-1.5">Event</label>
                                <select
                                    id="fb-event"
                                    value={draft.eventId}
                                    onChange={e => update({ eventId: e.target.value })}
                                    disabled={!eventsLoaded || events.length === 0}
                                    className={`w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/60 ${!eventsLoaded || events.length === 0 ? "opacity-60 cursor-not-allowed" : ""}`}
                                >
                                    <option value="" className="bg-gray-900">Select an event</option>
                                    {events.map(e => (
                                        <option key={e.id} value={e.id} className="bg-gray-900">{e.title}</option>
                                    ))}
                                </select>
                                {!eventsLoaded && (
                                    <p className="text-xs text-gray-500 mt-1">Loading events…</p>
                                )}
                                {eventsLoaded && events.length === 0 && (
                                    <p className="text-xs text-red-400 mt-1">No events found. Create an event first at /admin/events.</p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="fb-title" className="block text-sm font-semibold text-gray-200 mb-1.5">Title</label>
                                <input
                                    id="fb-title"
                                    type="text"
                                    maxLength={120}
                                    required
                                    value={draft.title}
                                    onChange={e => update({ title: e.target.value })}
                                    placeholder="e.g. Hackathon sign-up"
                                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60"
                                />
                            </div>
                            <div>
                                <label htmlFor="fb-desc" className="block text-sm font-semibold text-gray-200 mb-1.5">Description / instructions</label>
                                <textarea
                                    id="fb-desc"
                                    maxLength={2000}
                                    rows={3}
                                    value={draft.description}
                                    onChange={e => update({ description: e.target.value })}
                                    placeholder="What is this form for? Include any prerequisites."
                                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60 resize-y"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="fb-opens" className="block text-sm font-semibold text-gray-200 mb-1.5">Opens at <span className="text-gray-500 font-normal">(optional)</span></label>
                                    <input
                                        id="fb-opens"
                                        type="datetime-local"
                                        value={isoToLocalInput(draft.opensAt)}
                                        onChange={e => update({ opensAt: localInputToIso(e.target.value) })}
                                        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/60"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="fb-closes" className="block text-sm font-semibold text-gray-200 mb-1.5">Deadline <span className="text-gray-500 font-normal">(optional)</span></label>
                                    <input
                                        id="fb-closes"
                                        type="datetime-local"
                                        value={isoToLocalInput(draft.closesAt)}
                                        onChange={e => update({ closesAt: localInputToIso(e.target.value) })}
                                        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/60"
                                    />
                                </div>
                            </div>
                            {id && (
                                <div className="max-w-56">
                                    <label htmlFor="fb-status" className="block text-sm font-semibold text-gray-200 mb-1.5">Status</label>
                                    <select
                                        id="fb-status"
                                        value={draft.status}
                                        onChange={e => update({ status: e.target.value as FormStatus })}
                                        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/60"
                                    >
                                        <option value="draft" className="bg-gray-900">Draft — hidden from members</option>
                                        <option value="published" className="bg-gray-900">Published — open to members</option>
                                        <option value="closed" className="bg-gray-900">Closed — visible, no submissions</option>
                                    </select>
                                </div>
                            )}
                            <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-gray-400">
                                <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <span>
                                    New forms start as drafts. A deadline makes the form read-only automatically once it passes — the public page and the submission API both check the window.
                                </span>
                            </div>
                        </div>
                    </section>

                    {/* Fields */}
                    <section className="rounded-2xl border border-white/10 bg-black/30 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wide">Fields ({draft.fields.length})</h2>
                        </div>

                        {draft.fields.length === 0 ? (
                            <p className="text-sm text-gray-500 mb-4">No fields yet — add the first one below.</p>
                        ) : (
                            <ul className="space-y-2.5" aria-label="Form fields">
                                {draft.fields.map((field, i) => (
                                    <FieldCard
                                        key={field.id}
                                        field={field}
                                        index={i}
                                        count={draft.fields.length}
                                        expanded={expandedFieldId === field.id}
                                        onToggle={() => setExpandedFieldId(cur => (cur === field.id ? null : field.id))}
                                        onPatch={patch => patchField(field.id, patch)}
                                        onMove={dir => moveField(i, dir)}
                                        onRemove={() => removeField(i)}
                                        onDuplicate={() => duplicateField(i)}
                                        onDragStart={() => { dragIndex.current = i; }}
                                        onDrop={targetIndex => {
                                            const from = dragIndex.current;
                                            dragIndex.current = null;
                                            if (from === null || from === targetIndex) return;
                                            const fields = [...draft.fields];
                                            const [moved] = fields.splice(from, 1);
                                            fields.splice(targetIndex, 0, moved);
                                            update({ fields });
                                        }}
                                    />
                                ))}
                            </ul>
                        )}

                        {/* Add-field menu */}
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {TYPE_LIST.map(({ type, icon: Icon }) => (
                                <button
                                    key={type}
                                    type="button"
                                    disabled={draft.fields.length >= 50}
                                    onClick={() => addField(type)}
                                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40"
                                >
                                    <Icon size={14} aria-hidden="true" /> {FORM_FIELD_META[type].label}
                                </button>
                            ))}
                        </div>
                    </section>
                </div>

                {/* ── Preview column ── */}
                {showPreview && (
                    <section aria-label="Live preview" className="rounded-2xl border border-white/10 bg-black/30 p-5 self-start lg:sticky lg:top-6">
                        <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-4">Preview as members see it</h2>
                        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                            <h3 className="text-lg font-bold text-white">{draft.title || "Untitled form"}</h3>
                            {draft.description && <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{draft.description}</p>}
                            <div className="h-px bg-white/10 my-4" />
                            {draft.fields.length === 0 ? (
                                <p className="text-xs text-gray-500 italic">No fields to preview yet.</p>
                            ) : (
                                <FormRenderer
                                    form={{ fields: draft.fields } as never}
                                    values={previewValues}
                                    errors={previewTouched}
                                    onValueChange={(fid, v) => setPreviewValues(p => ({ ...p, [fid]: v }))}
                                    onBlur={fid => {
                                        const field = draft.fields.find(f => f.id === fid);
                                        if (!field?.required) return;
                                        const errs = validateSubmission({ fields: [field] }, { [fid]: previewValues[field.id] });
                                        setPreviewTouched(p => ({ ...p, [fid]: errs[field.id] ?? "" }));
                                    }}
                                />
                            )}
                        </div>
                    </section>
                )}
            </div>

            {/* Unsaved-changes leaving dialog */}
            {leaveConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="leave-title">
                    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-gray-900 p-6">
                        <h2 id="leave-title" className="text-lg font-bold text-white flex items-center gap-2">
                            <AlertTriangle size={18} className="text-amber-400" aria-hidden="true" /> Unsaved changes
                        </h2>
                        <p className="mt-2 text-sm text-gray-300">Leave without saving? Your edits to this form will be lost.</p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button type="button" onClick={() => setLeaveConfirm(false)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors">
                                Keep editing
                            </button>
                            <button
                                type="button"
                                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition-colors"
                                onClick={() => { if (id) router.push(`/admin/forms/${id}/edit`); router.push("/admin/forms"); }}
                            >
                                Leave without saving
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Field card ──────────────────────────────────────────────────────────────

function FieldCard({
    field, index, count, expanded, onToggle, onPatch, onMove, onRemove, onDuplicate, onDragStart, onDrop,
}: {
    field: FormFormField;
    index: number;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    onPatch: (patch: Partial<FormFormField>) => void;
    onMove: (dir: -1 | 1) => void;
    onRemove: () => void;
    onDuplicate: () => void;
    onDragStart: () => void;
    onDrop: (targetIndex: number) => void;
}) {
    const Icon = TYPE_ICON[field.type];
    const meta = FORM_FIELD_META[field.type];
    const shell = "w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60";

    return (
        <li
            draggable
            onDragStart={onDragStart}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); onDrop(index); }}
            className={`rounded-xl border transition-colors ${expanded ? "border-blue-500/40 bg-blue-500/5" : "border-white/10 bg-white/5"}`}
        >
            <div className="flex items-center gap-2 px-3 py-2.5">
                <GripVertical size={16} className="text-gray-500 cursor-grab shrink-0" aria-hidden="true" />
                <span className="text-gray-400" aria-hidden="true"><Icon size={15} /></span>
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    className="min-w-0 flex-1 text-left"
                >
                    <span className="block truncate text-sm font-semibold text-white">
                        {field.label || <span className="italic text-gray-400">Untitled {meta.label.toLowerCase()} field</span>}
                    </span>
                    <span className="text-[11px] text-gray-500">
                        {meta.label}
                        {field.required ? " • required" : ""}
                        {meta.needsOptions ? ` • ${field.options?.filter(Boolean).length ?? 0} options` : ""}
                    </span>
                </button>
                <div className="flex items-center gap-0.5 shrink-0 text-gray-500">
                    <button type="button" onClick={onToggle} aria-label={`Edit field ${field.label || index + 1}`} className="rounded-lg p-2 hover:bg-white/10 hover:text-white transition-colors">
                        <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move field up" className="rounded-lg p-2 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30">
                        <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move field down" className="rounded-lg p-2 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30">
                        <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={onDuplicate} aria-label="Duplicate field" className="rounded-lg p-2 hover:bg-white/10 hover:text-white transition-colors">
                        <Copy size={14} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={onRemove} aria-label="Remove field" className="rounded-lg p-2 hover:bg-red-500/20 hover:text-red-400 transition-colors">
                        <Trash2 size={14} aria-hidden="true" />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="border-t border-white/10 px-3 py-3 space-y-3">
                    <div>
                        <label htmlFor={`fl-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Field label</label>
                        <input
                            id={`fl-${field.id}`}
                            type="text"
                            maxLength={200}
                            value={field.label}
                            onChange={e => onPatch({ label: e.target.value })}
                            placeholder="e.g. Team name"
                            className={shell}
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label htmlFor={`fh-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Help text (optional)</label>
                            <input
                                id={`fh-${field.id}`}
                                type="text"
                                maxLength={500}
                                value={field.helpText ?? ""}
                                onChange={e => onPatch({ helpText: e.target.value })}
                                className={shell}
                            />
                        </div>
                        <div>
                            <label htmlFor={`fp-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Placeholder (optional)</label>
                            <input
                                id={`fp-${field.id}`}
                                type="text"
                                maxLength={200}
                                value={field.placeholder ?? ""}
                                onChange={e => onPatch({ placeholder: e.target.value })}
                                className={shell}
                            />
                        </div>
                    </div>

                    {meta.needsOptions && (
                        <OptionsEditor field={field} onPatch={onPatch} />
                    )}

                    {meta.needsMinMax && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor={`fmin-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Minimum (optional)</label>
                                <input
                                    id={`fmin-${field.id}`}
                                    type="number"
                                    value={field.min ?? ""}
                                    onChange={e => onPatch({ min: e.target.value === "" ? null : Number(e.target.value) })}
                                    className={shell}
                                />
                            </div>
                            <div>
                                <label htmlFor={`fmax-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Maximum (optional)</label>
                                <input
                                    id={`fmax-${field.id}`}
                                    type="number"
                                    value={field.max ?? ""}
                                    onChange={e => onPatch({ max: e.target.value === "" ? null : Number(e.target.value) })}
                                    className={shell}
                                />
                            </div>
                        </div>
                    )}

                    {meta.hasDefault && (
                        <DefaultValueEditor field={field} onPatch={onPatch} />
                    )}

                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            className="h-4 w-4 accent-blue-500"
                            checked={field.required}
                            onChange={e => onPatch({ required: e.target.checked })}
                        />
                        Required field
                    </label>
                </div>
            )}
        </li>
    );
}

// ── Options + default value sub-editors ─────────────────────────────────────

function OptionsEditor({ field, onPatch }: { field: FormFormField; onPatch: (p: Partial<FormFormField>) => void }) {
    const [newOption, setNewOption] = useState("");
    const options = field.options ?? [];
    const add = () => {
        const v = newOption.trim().slice(0, 100);
        if (options.some(o => o.toLowerCase() === v.toLowerCase())) { setNewOption(""); return; }
        onPatch({ options: [...options, v] });
        setNewOption("");
    };
    return (
        <div>
            <span className="block text-xs font-semibold text-gray-300 mb-1">Options</span>
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Options">
                {options.map((opt, i) => (
                    <li key={i} className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/25 px-2.5 py-1 text-xs text-blue-200">
                        {opt}
                        <button type="button" onClick={() => onPatch({ options: options.filter((_, j) => j !== i) })} aria-label={`Remove option ${opt}`} className="hover:text-white">
                            ×
                        </button>
                    </li>
                ))}
            </ul>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={newOption}
                    maxLength={100}
                    onChange={e => setNewOption(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                    placeholder="Add an option…"
                    aria-label={`Add option to ${field.label || "field"}`}
                    className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3.5 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60"
                />
                <button type="button" onClick={add} className="rounded-xl bg-blue-600/80 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-500 transition-colors inline-flex items-center gap-1">
                    <Plus size={13} aria-hidden="true" /> Add
                </button>
            </div>
        </div>
    );
}

function DefaultValueEditor({ field, onPatch }: { field: FormFormField; onPatch: (p: Partial<FormFormField>) => void }) {
    const dv = field.defaultValue;
    const shell = "w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60";
    const setDefault = (v: string | number | boolean | string[] | null) => onPatch({ defaultValue: v });

    if (field.type === "checkbox") {
        return (
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-300 cursor-pointer">
                <input
                    type="checkbox"
                    className="h-4 w-4 accent-blue-500"
                    checked={dv === true}
                    onChange={e => setDefault(e.target.checked)}
                />
                Pre-checked for respondents
            </label>
        );
    }
    if (field.type === "singleChoice" || field.type === "dropdown") {
        return (
            <div>
                <label htmlFor={`fd-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Default option (optional)</label>
                <select
                    id={`fd-${field.id}`}
                    value={typeof dv === "string" ? dv : ""}
                    onChange={e => setDefault(e.target.value || null)}
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500/60"
                >
                    <option value="" className="bg-gray-900">None</option>
                    {field.options?.map(o => <option key={o} value={o} className="bg-gray-900">{o}</option>)}
                </select>
            </div>
        );
    }
    if (field.type === "multiChoice") {
        const selected = Array.isArray(dv) ? dv : [];
        return (
            <div>
                <span className="block text-xs font-semibold text-gray-300 mb-1">Pre-selected options (optional)</span>
                <div className="flex flex-wrap gap-1.5">
                    {field.options?.map(o => {
                        const on = selected.includes(o);
                        return (
                            <button
                                key={o}
                                type="button"
                                onClick={() => setDefault(on ? selected.filter(x => x !== o) : [...selected, o])}
                                aria-pressed={on}
                                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on ? "bg-blue-500/25 border-blue-500/40 text-white" : "bg-white/5 border-white/10 text-gray-400 hover:text-white"}`}
                            >
                                {o}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }
    if (field.type === "number") {
        return (
            <div className="max-w-56">
                <label htmlFor={`fd-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Default value (optional)</label>
                <input
                    id={`fd-${field.id}`}
                    type="number"
                    value={typeof dv === "number" ? dv : ""}
                    onChange={e => setDefault(e.target.value === "" ? null : Number(e.target.value))}
                    className={shell}
                />
            </div>
        );
    }
    if (field.type === "date") {
        return (
            <div className="max-w-56 relative cursor-pointer" onClick={e => {
                e.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
            }}>
                <label htmlFor={`fd-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Default value (optional)</label>
                <input
                    id={`fd-${field.id}`}
                    type="date"
                    value={typeof dv === "string" && dv ? dv : ""}
                    onChange={e => setDefault(e.target.value || null)}
                    className={`${shell} pl-9`}
                />
                <button
                    type="button"
                    onClick={e => {
                        e.stopPropagation();
                        e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                    }}
                    aria-label="Open date picker"
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white transition-colors"
                >
                    <CalendarDays size={16} aria-hidden="true" />
                </button>
            </div>
        );
    }
    const limit = field.type === "longText" ? 5000 : 500;
    return (
        <div>
            <label htmlFor={`fd-${field.id}`} className="block text-xs font-semibold text-gray-300 mb-1">Default value (optional)</label>
            <input
                id={`fd-${field.id}`}
                type="text"
                maxLength={limit}
                value={typeof dv === "string" ? dv : ""}
                onChange={e => setDefault(e.target.value || null)}
                className={shell}
            />
        </div>
    );
}
