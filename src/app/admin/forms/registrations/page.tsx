"use client";

/**
 * Form submissions management: pick a form, browse/search its submissions and
 * export them in any of the seven supported formats (CSV, XLSX, PDF, DOCX,
 * JSON, TXT, HTML). Exports run server-side from persisted Firestore data and
 * honour the current search filter, so admins can export exactly what is on
 * screen or everything.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import {
    subscribeToForms,
    subscribeToFormSubmissions,
    exportFormRegistrations,
    ApiError,
} from "@/services/forms";
import { formatAnswerValue, resolveFieldLabel } from "@/lib/forms";
import { EXPORT_FORMATS } from "@/lib/export/formExports";
import type { Form, FormSubmission } from "@/types/forms";
import {
    ClipboardList, ChevronDown, Download, ExternalLink, FileText,
    RefreshCw, Search, Users,
} from "lucide-react";

const PAGE_SIZE = 300;

export default function FormRegistrationsPage() {
    const toast = useToast();
    const [forms, setForms] = useState<Form[]>([]);
    const [formsLoading, setFormsLoading] = useState(true);
    const [formId, setFormId] = useState<string | null>(null);
    const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
    const [subsLoading, setSubsLoading] = useState(false);
    const [subsError, setSubsError] = useState(false);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const [exportingFormat, setExportingFormat] = useState<string | null>(null);

    // Deep link: /admin/forms/registrations?form=<id> (set by the Forms list page).
    useEffect(() => {
        const wanted = new URLSearchParams(window.location.search).get("form");
        if (wanted) setFormId(wanted);
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        const unsub = subscribeToForms(
            fs => {
                setForms(fs);
                setFormsLoading(false);
                // Default to the newest published form if nothing is selected yet.
                setFormId(cur => cur ?? fs.find(f => f.status === "published")?.id ?? fs[0]?.id ?? null);
            },
            () => setFormsLoading(false)
        );
        return unsub;
    }, []);

    useEffect(() => {
        if (!formId) { setSubmissions([]); return; }
        setSubsLoading(true);
        setSubsError(false);
        setSelected(new Set());
        setExpanded(new Set());
        const unsub = subscribeToFormSubmissions(
            formId,
            PAGE_SIZE,
            subs => { setSubmissions(subs); setSubsLoading(false); },
            () => { setSubsError(true); setSubsLoading(false); }
        );
        return unsub;
    }, [formId]);

    const form = useMemo(() => forms.find(f => f.id === formId) ?? null, [forms, formId]);

    const filtered = useMemo(() => {
        if (!search) return submissions;
        return submissions.filter(s =>
            s.userName.toLowerCase().includes(search) ||
            s.userEmail.toLowerCase().includes(search) ||
            Object.entries(s.answers).some(([fid, v]) => {
                const field = form?.fields.find(f => f.id === fid);
                return formatAnswerValue(field, v as never).toLowerCase().includes(search) ||
                    (field?.label ?? "").toLowerCase().includes(search);
            })
        );
    }, [submissions, search, form]);

    const selectedForm = forms.find(f => f.id === formId) ?? null;

    const toggleSelected = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const exportAs = async (format: string) => {
        setExportMenuOpen(false);
        if (!selectedForm) return;
        setExportingFormat(format);
        try {
            await exportFormRegistrations(selectedForm, format, search);
            toast.success(`Exported as ${format.toUpperCase()}${search ? " (current filter)" : ""}.`);
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Export failed. Please try again.");
        } finally {
            setExportingFormat(null);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader
                title="Form Registrations"
                subtitle="Browse, search and export submissions collected by your forms."
                icon={<ClipboardList size={26} />}
                actions={
                    <Link
                        href="/admin/forms"
                        className="bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                    >
                        <ExternalLink size={15} aria-hidden="true" /> All forms
                    </Link>
                }
            />

            {/* Form picker + toolbar */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative sm:w-80 shrink-0">
                    <label htmlFor="form-picker" className="sr-only">Choose a form</label>
                    <div className="flex items-center rounded-xl border border-white/10 bg-white/5 focus-within:border-blue-500/60">
                        <FileText size={16} className="ml-3 text-gray-400 shrink-0" aria-hidden="true" />
                        <select
                            id="form-picker"
                            value={formId ?? ""}
                            onChange={e => setFormId(e.target.value || null)}
                            className="w-full bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none appearance-none pr-8"
                        >
                            <option value="" disabled className="bg-gray-900">{formsLoading ? "Loading forms…" : "Select a form"}</option>
                            {forms.map(f => (
                                <option key={f.id} value={f.id} className="bg-gray-900">
                                    {f.title || "Untitled form"} ({f.submissionCount})
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={15} className="mr-3 text-gray-400 shrink-0 pointer-events-none" aria-hidden="true" />
                    </div>
                </div>

                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} aria-hidden="true" />
                    <label htmlFor="sub-search" className="sr-only">Search submissions</label>
                    <input
                        id="sub-search"
                        type="search"
                        placeholder="Search by name, email or any answer…"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        disabled={!formId}
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60 disabled:opacity-50"
                    />
                </div>

                {/* Export menu */}
                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setExportMenuOpen(o => !o)}
                        disabled={!formId || exportingFormat !== null}
                        aria-expanded={exportMenuOpen}
                        aria-haspopup="menu"
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition-colors disabled:opacity-50 h-full"
                    >
                        {exportingFormat
                            ? <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
                            : <Download size={15} aria-hidden="true" />}
                        {exportingFormat ? `Exporting ${exportingFormat.toUpperCase()}…` : "Export"}
                        <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    {exportMenuOpen && (
                        <div
                            role="menu"
                            aria-label="Export formats"
                            className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/10 bg-gray-900 shadow-xl p-1.5"
                        >
                            <p className="px-2.5 pt-1 pb-2 text-[11px] uppercase tracking-wide text-gray-500 font-bold">
                                {search ? `Filtered results (${filtered.length})` : `All submissions (${filtered.length})`}
                            </p>
                            {EXPORT_FORMATS.map(f => (
                                <button
                                    key={f.id}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => exportAs(f.id)}
                                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm text-gray-200 hover:bg-white/10 transition-colors"
                                >
                                    <span className="font-semibold">{f.label}</span>
                                    <span className="text-xs text-gray-500 font-mono">.{f.id === "xlsx" ? "xlsx" : f.id}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {!formId && !formsLoading && forms.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center text-gray-400">
                    <Users size={40} className="mx-auto mb-4 text-gray-600" aria-hidden="true" />
                    <p className="font-bold text-white mb-1">No forms yet</p>
                    <p className="text-sm mb-4">Create a form first — its submissions will appear here.</p>
                    <Link href="/admin/forms/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition-colors">
                        Create a form
                    </Link>
                </div>
            ) : !formId && !formsLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center text-gray-400">
                    <Users size={40} className="mx-auto mb-4 text-gray-600" aria-hidden="true" />
                    <p className="font-bold text-white mb-1">Select a form</p>
                    <p className="text-sm">Choose a form above to view and export its submissions.</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm">
                        <p className="text-gray-300">
                            <span className="font-bold text-white">{filtered.length}</span>
                            {` ${filtered.length === 1 ? "submission" : "submissions"}`}
                            {search && ` matching “${searchInput.trim()}”`}
                            {form && <span className="text-gray-500"> · {form.title}</span>}
                        </p>
                        {form && (
                            <Link
                                href={`/forms/${form.id}`}
                                target="_blank"
                                className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                            >
                                Public page <ExternalLink size={11} aria-hidden="true" />
                            </Link>
                        )}
                    </div>

                    {subsLoading ? (
                        <div className="h-56 flex flex-col items-center justify-center gap-3 text-gray-400" role="status">
                            <RefreshCw size={22} className="animate-spin text-blue-500" aria-hidden="true" />
                            Loading submissions…
                        </div>
                    ) : subsError ? (
                        <div className="h-56 flex flex-col items-center justify-center gap-3 text-red-300">
                            <p>Could not load submissions.</p>
                            <button type="button" onClick={() => setFormId(id => id)} className="text-sm underline">Retry</button>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="h-56 flex flex-col items-center justify-center gap-2 text-gray-400">
                            <Users size={30} className="text-gray-600" aria-hidden="true" />
                            {submissions.length === 0
                                ? <p>No submissions yet for this form.</p>
                                : <p>No submissions match “{searchInput.trim()}”.</p>}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-black/30 text-gray-400 text-xs uppercase">
                                    <tr>
                                        <th scope="col" className="px-4 py-3 font-bold w-10">
                                            <span className="sr-only">Select</span>
                                            <input
                                                type="checkbox"
                                                aria-label="Select all visible submissions"
                                                className="h-4 w-4 accent-blue-500"
                                                checked={selected.size > 0 && selected.size === filtered.length}
                                                onChange={e => setSelected(e.target.checked ? new Set(filtered.map(s => s.id)) : new Set())}
                                            />
                                        </th>
                                        <th scope="col" className="px-4 py-3 font-bold">Submitted by</th>
                                        {form?.fields.slice(0, 3).map(f => (
                                            <th key={f.id} scope="col" className="px-4 py-3 font-bold max-w-48 truncate" title={f.label}>{f.label}</th>
                                        ))}
                                        <th scope="col" className="px-4 py-3 font-bold">Submitted at</th>
                                        <th scope="col" className="px-4 py-3 font-bold w-10"><span className="sr-only">Details</span></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {filtered.map(s => (
                                        <SubmissionRow
                                            key={s.id}
                                            s={s}
                                            form={form}
                                            expanded={expanded.has(s.id)}
                                            selected={selected.has(s.id)}
                                            onToggleSelect={() => toggleSelected(s.id)}
                                            onToggleExpand={() => setExpanded(prev => {
                                                const next = new Set(prev);
                                                if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                                                return next;
                                            })}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {selected.size > 0 && (
                <p className="text-xs text-gray-500" role="status">
                    {selected.size} selected. Selection is for visual scanning — use Export to download data.
                </p>
            )}
        </div>
    );
}

// ── Row ─────────────────────────────────────────────────────────────────────

function SubmissionRow({
    s, form, expanded, selected, onToggleSelect, onToggleExpand,
}: {
    s: FormSubmission;
    form: Form | null;
    expanded: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onToggleExpand: () => void;
}) {
    const fields = form?.fields ?? [];
    const answerEntries = Object.entries(s.answers) as [string, NonNullable<FormSubmission["answers"][string]>][];
    const removedEntries = answerEntries.filter(([fid]) => !fields.some(f => f.id === fid));
    const preview = fields.slice(0, 3).map(f => formatAnswerValue(f, s.answers[f.id] ?? null));

    return (
        <>
            <tr className={`hover:bg-white/5 transition-colors ${selected ? "bg-blue-500/10" : ""}`}>
                <td className="px-4 py-3">
                    <input
                        type="checkbox"
                        aria-label={`Select submission by ${s.userName}`}
                        className="h-4 w-4 accent-blue-500"
                        checked={selected}
                        onChange={onToggleSelect}
                    />
                </td>
                <td className="px-4 py-3">
                    <div className="font-medium text-white">{s.userName || "Unknown member"}</div>
                    <div className="text-xs text-gray-400 font-mono">{s.userEmail}</div>
                </td>
                {preview.map((txt, i) => (
                    <td key={i} className="px-4 py-3 text-gray-300 max-w-56">
                        <span className="line-clamp-2">{txt || <span className="text-gray-600">—</span>}</span>
                    </td>
                ))}
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {s.submittedAt ? new Date(s.submittedAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3">
                    <button
                        type="button"
                        onClick={onToggleExpand}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} all answers from ${s.userName}`}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
                    >
                        <ChevronDown size={16} className={expanded ? "rotate-180" : ""} aria-hidden="true" />
                    </button>
                </td>
            </tr>
            {expanded && (
                <tr className="bg-black/40">
                    <td colSpan={4 + Math.min(fields.length, 3)} className="px-6 py-4">
                        <dl className="space-y-3 max-w-3xl">
                            {answerEntries.length === 0 && (
                                <p className="text-gray-500 text-sm">No answers recorded.</p>
                            )}
                            {answerEntries.map(([fid, value]) => {
                                const resolved = resolveFieldLabel(form ?? { fields: [] }, fid);
                                const field = fields.find(f => f.id === fid);
                                const text = formatAnswerValue(field, value);
                                return (
                                    <div key={fid} className="grid sm:grid-cols-[220px_1fr] gap-1 sm:gap-4">
                                        <dt className={`text-xs font-bold uppercase tracking-wide ${resolved.removed ? "text-amber-400" : "text-gray-400"}`}>
                                            {resolved.label}
                                        </dt>
                                        <dd className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                                            {text || <span className="text-gray-600">Empty</span>}
                                        </dd>
                                    </div>
                                );
                            })}
                            {removedEntries.length > 0 && (
                                <p className="text-xs text-gray-500 pt-1">
                                    + {removedEntries.length} answer{removedEntries.length > 1 ? "s" : ""} to a field that has since been removed from this form (included in exports).
                                </p>
                            )}
                        </dl>
                    </td>
                </tr>
            )}
        </>
    );
}
