"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, Search, ChevronDown, ChevronRight, Pencil, Trash2, RefreshCw, X, AlertCircle, CheckCircle2, GraduationCap, Loader2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useAuth } from "@/lib/auth";

const PAGE_SIZE = 12;

interface StudentRow {
    uid: string;
    email: string;
    displayName: string;
    rollNo: string;
    class: string;
    section: string;
    mobile: string;
    hosteller: boolean;
    isVerified: boolean;
    photoURL: string;
    createdAt: string | null;
}

interface StudentsResponse {
    students: StudentRow[];
    total: number;
    page: number;
    pageCount: number;
    truncated?: boolean;
    can: { edit: boolean; delete: boolean };
}

/** Editable profile fields — identifiers (uid, createdAt) are never editable.
 * Verification comes from Firebase email verification, not from here.
 */
interface EditForm {
    displayName: string;
    email: string;
    rollNo: string;
    class: string;
    section: string;
    mobile: string;
    hosteller: boolean;
}

const inputClass = "w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-white text-sm focus:border-blue-500 outline-none";

export default function StudentsPage() {
    const toast = useToast();
    const { profile } = useAuth();

    const [data, setData] = useState<StudentsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [verified, setVerified] = useState<"all" | "true" | "false">("all");
    const [sort, setSort] = useState<"newest" | "oldest" | "name" | "email">("newest");
    const [expandedUid, setExpandedUid] = useState<string | null>(null);

    // Edit drawer
    const [editing, setEditing] = useState<StudentRow | null>(null);
    const [form, setForm] = useState<EditForm | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState("");
    const [saving, setSaving] = useState(false);

    // Delete confirmation
    const [deleting, setDeleting] = useState<StudentRow | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    const requestId = useRef(0);
    const can = data?.can ?? { edit: false, delete: false };

    // Debounce search so typing doesn't spam the API.
    useEffect(() => {
        const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
        return () => clearTimeout(t);
    }, [searchInput]);

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        const id = ++requestId.current;
        if (!opts?.silent) setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            if (!headers) throw new Error("You are not signed in.");
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), search, verified, sort });
            const res = await fetch(`/api/admin/students?${params}`, { headers });
            if (res.status === 401) throw new Error("Session expired — sign in again.");
            if (res.status === 403) throw new Error("You do not have permission to view student accounts.");
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to load students (${res.status}).`);
            }
            const json: StudentsResponse = await res.json();
            if (id === requestId.current) setData(json);
        } catch (e: any) {
            if (id === requestId.current) setError(e?.message || "Failed to load student accounts.");
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [page, search, verified, sort]);

    useEffect(() => { load(); }, [load]);

    const validateForm = (f: EditForm): Record<string, string> => {
        const errs: Record<string, string> = {};
        if (f.displayName.length > 60) errs.displayName = "Name must be under 60 characters.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = "Enter a valid email address.";
        if (f.email.length > 200) errs.email = "Email must be under 200 characters.";
        if (f.rollNo.length > 30) errs.rollNo = "Roll number must be under 30 characters.";
        if (f.class.length > 30) errs.class = "Department must be under 30 characters.";
        if (f.section.length > 10) errs.section = "Section must be under 10 characters.";
        if (f.mobile && !/^\+?[0-9\- ]{1,15}$/.test(f.mobile)) errs.mobile = "Use digits, spaces, hyphens and a leading + only.";
        return errs;
    };

    const openEdit = (student: StudentRow) => {
        setEditing(student);
        setFieldErrors({});
        setFormError("");
        setForm({
            displayName: student.displayName,
            email: student.email,
            rollNo: student.rollNo,
            class: student.class,
            section: student.section,
            mobile: student.mobile,
            hosteller: student.hosteller,
        });
    };

    const saveEdit = async () => {
        if (!editing || !form || saving) return; // duplicate submit guard
        const errs = validateForm(form);
        if (Object.keys(errs).length > 0) {
            setFieldErrors(errs);
            return;
        }
        setSaving(true);
        setFormError("");
        try {
            const headers = await getAuthHeaders();
            if (!headers) throw new Error("You are not signed in.");
            // Send only changed fields (and client identifiers never travel).
            const changed: Record<string, unknown> = {};
            if (form.displayName !== editing.displayName) changed.displayName = form.displayName;
            if (form.email.trim().toLowerCase() !== editing.email) changed.email = form.email;
            if (form.rollNo !== editing.rollNo) changed.rollNo = form.rollNo;
            if (form.class !== editing.class) changed.class = form.class;
            if (form.section !== editing.section) changed.section = form.section;
            if (form.mobile !== editing.mobile) changed.mobile = form.mobile;
            if (form.hosteller !== editing.hosteller) changed.hosteller = form.hosteller;
            if (Object.keys(changed).length === 0) {
                toast.info("No changes to save.");
                setEditing(null);
                return;
            }
            const res = await fetch("/api/admin/students", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...headers },
                body: JSON.stringify({ uid: editing.uid, data: changed }),
            });
            const json = await res.json().catch(() => ({}));
            if (res.status === 409) {
                setFormError(json.error || "That value is already in use.");
                return; // keep the form so the admin can fix it
            }
            if (!res.ok) {
                setFormError(json.error || `Save failed (${res.status}).`);
                return;
            }
            toast.success(json.updated.includes("email")
                ? "Profile updated. The sign-in email was changed; they will need to re-verify it."
                : "Profile updated.");
            setEditing(null);
            setForm(null);
            await load({ silent: true });
        } catch (e: any) {
            setFormError(e?.message || "Save failed.");
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleting || deleteBusy) return;
        setDeleteBusy(true);
        try {
            const headers = await getAuthHeaders();
            if (!headers) throw new Error("You are not signed in.");
            const res = await fetch(`/api/admin/students?uid=${encodeURIComponent(deleting.uid)}`, { method: "DELETE", headers });
            const json = await res.json().catch(() => ({}));
            if (res.status === 404) {
                toast.warning("Account was already deleted.");
            } else if (!res.ok) {
                toast.error(json.error || `Delete failed (${res.status}).`);
            } else {
                toast.success(`${deleting.email || deleting.uid} deleted.`);
            }
            setDeleting(null);
            await load({ silent: true });
        } catch (e: any) {
            toast.error(e?.message || "Delete failed.");
        } finally {
            setDeleteBusy(false);
        }
    };

    const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
    const dash = (v: string) => (v && v.trim() ? v : "—");

    return (
        <div className="max-w-6xl mx-auto text-white">
            <PageHeader
                title="Registered Students"
                subtitle="All site accounts — Inspect details, edit profiles and manage accounts."
                icon={<Users size={26} />}
                actions={
                    <button
                        onClick={() => load()}
                        className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white transition-colors"
                        title="Refresh"
                        aria-label="Refresh student list"
                    >
                        <RefreshCw size={16} />
                    </button>
                }
            />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="relative flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                    <input
                        type="search"
                        aria-label="Search students"
                        placeholder="Search name, email, roll no, department, account id…"
                        className={`${inputClass} pl-9`}
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                    />
                </div>
                <select aria-label="Filter students" className={`${inputClass} sm:w-44`} value={verified} onChange={e => { setVerified(e.target.value as typeof verified); setPage(1); }}>
                    <option value="all">All statuses</option>
                    <option value="true">Verified</option>
                    <option value="false">Not verified</option>
                </select>
                <select aria-label="Sort students" className={`${inputClass} sm:w-44`} value={sort} onChange={e => { setSort(e.target.value as typeof sort); setPage(1); }}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="name">Name A→Z</option>
                    <option value="email">Email A→Z</option>
                </select>
            </div>

            {/* Content states */}
            {loading ? (
                <div className="space-y-2" role="status" aria-label="Loading students">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
                    ))}
                </div>
            ) : error ? (
                <div className="p-8 text-center bg-white/5 rounded-2xl border border-red-500/25" role="alert">
                    <AlertCircle className="mx-auto text-red-400 mb-3" size={28} />
                    <p className="text-red-300 font-semibold mb-1">Could not load student accounts</p>
                    <p className="text-gray-400 text-sm mb-4">{error}</p>
                    <button onClick={() => load()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold">
                        Try again
                    </button>
                </div>
            ) : !data || data.students.length === 0 ? (
                <div className="p-12 text-center bg-white/5 rounded-2xl border border-white/10">
                    <GraduationCap className="mx-auto text-gray-600 mb-4" size={40} />
                    {search || verified !== "all" ? (
                        <>
                            <p className="text-gray-300 font-medium">No students match the current filters.</p>
                            <button onClick={() => { setSearchInput(""); setVerified("all"); setPage(1); }} className="mt-3 text-sm text-blue-400 hover:text-blue-300">
                                Clear filters
                            </button>
                        </>
                    ) : (
                        <p className="text-gray-400">No student accounts exist yet. Students appear here after they sign up on the site.</p>
                    )}
                </div>
            ) : (
                <>
                    {data.truncated && data.total >= PAGE_SIZE * 8 && (
                        <p className="mb-3 text-xs text-yellow-400/80">Large account list — showing the {PAGE_SIZE * 8}+ most recent accounts; use search to find older students quickly.</p>
                    )}
                    <div className="rounded-2xl border border-white/10 overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white/5 text-xs uppercase tracking-wider text-gray-500">
                                <tr>
                                    <th scope="col" className="px-4 py-3">Student</th>
                                    <th scope="col" className="px-4 py-3 hidden md:table-cell">Roll No / Dept</th>
                                    <th scope="col" className="px-4 py-3 hidden lg:table-cell">Registered</th>
                                    <th scope="col" className="px-4 py-3">Status</th>
                                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {data.students.map(student => (
                                    <StudentRowView
                                        key={student.uid}
                                        student={student}
                                        expanded={expandedUid === student.uid}
                                        onToggle={() => setExpandedUid(expandedUid === student.uid ? null : student.uid)}
                                        canEdit={can.edit}
                                        canDelete={can.delete}
                                        onEdit={() => openEdit(student)}
                                        onDelete={() => setDeleting(student)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
                        <span aria-live="polite">
                            {Math.min((data.page - 1) * PAGE_SIZE + 1, data.total)}–{Math.min(data.page * PAGE_SIZE, data.total)} of {data.total}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={data.page <= 1}
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30"
                                aria-label="Previous page"
                            >
                                Prev
                            </button>
                            <span className="px-2">Page {data.page} / {data.pageCount}</span>
                            <button
                                onClick={() => setPage(p => Math.min(data.pageCount, p + 1))}
                                disabled={data.page >= data.pageCount}
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30"
                                aria-label="Next page"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Edit drawer */}
            {editing && form && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/70" role="dialog" aria-modal="true" aria-labelledby="edit-student-title" onClick={e => { if (e.target === e.currentTarget && !saving) setEditing(null); }}>
                    <div className="w-full max-w-md bg-[#0c0c14] border-l border-white/10 p-6 overflow-y-auto" onKeyDown={e => { if (e.key === "Escape" && !saving) setEditing(null); }}>
                        <div className="flex items-center justify-between mb-2">
                            <h2 id="edit-student-title" className="text-lg font-bold">Edit Student</h2>
                            <button onClick={() => !saving && setEditing(null)} className="p-2 text-gray-500 hover:text-white" aria-label="Close editor">
                                <X size={18} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-4 break-all">Account ID: {editing.uid} · registered {fmtDate(editing.createdAt)} (never editable)</p>

                        {formError && (
                            <p role="alert" className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-sm text-red-300 flex items-start gap-2">
                                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {formError}
                            </p>
                        )}

                        <div className="space-y-4">
                            <Field label="Name" id="f-name" error={fieldErrors.displayName}>
                                <input id="f-name" className={inputClass} value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} aria-invalid={!!fieldErrors.displayName} />
                            </Field>
                            <Field label="Email (sign-in)" id="f-email" error={fieldErrors.email} hint={form.email !== editing.email ? "Changing the email updates their sign-in email and requires re-verification." : undefined}>
                                <input id="f-email" className={inputClass} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} aria-invalid={!!fieldErrors.email} />
                            </Field>
                            <Field label="Roll Number" id="f-roll" error={fieldErrors.rollNo} hint="Must be unique across all students.">
                                <input id="f-roll" className={inputClass} value={form.rollNo} onChange={e => setForm({ ...form, rollNo: e.target.value })} aria-invalid={!!fieldErrors.rollNo} />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Department" id="f-class" error={fieldErrors.class}>
                                    <input id="f-class" className={inputClass} value={form.class} onChange={e => setForm({ ...form, class: e.target.value })} aria-invalid={!!fieldErrors.class} />
                                </Field>
                                <Field label="Section" id="f-section" error={fieldErrors.section}>
                                    <input id="f-section" className={inputClass} value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} aria-invalid={!!fieldErrors.section} />
                                </Field>
                            </div>
                            <Field label="Mobile" id="f-mobile" error={fieldErrors.mobile}>
                                <input id="f-mobile" className={inputClass} value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} aria-invalid={!!fieldErrors.mobile} />
                            </Field>
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="checkbox" className="accent-blue-500" checked={form.hosteller} onChange={e => setForm({ ...form, hosteller: e.target.checked })} />
                                Hosteller
                            </label>
                            <p className="text-xs text-gray-600">Editing a student&apos;s profile never changes their club role, admin access, or Firebase verification status. Verification follows their Firebase emailVerified flag.</p>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => !saving && setEditing(null)} className="px-4 py-2 text-gray-400 hover:text-white" disabled={saving}>Cancel</button>
                            <button onClick={saveEdit} disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2">
                                {saving && <Loader2 size={14} className="animate-spin" />} {saving ? "Saving…" : "Save changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation */}
            {deleting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-student-title">
                    <div className="bg-[#0c0c14] border border-red-500/30 rounded-xl p-6 w-full max-w-md">
                        <h2 id="delete-student-title" className="text-lg font-bold mb-2 flex items-center gap-2 text-red-400"><Trash2 size={18} /> Delete student account</h2>
                        <p className="text-sm text-gray-300">
                            Permanently delete <strong>{deleting.email || deleting.uid}</strong> and their account data?
                        </p>
                        <ul className="text-xs text-gray-500 mt-2 space-y-1">
                            <li>• Their profile, avatar reference and pending requests are removed.</li>
                            <li>• Their sign-in account is deleted and cannot be restored.</li>
                            <li>• Past event registrations remain as historical records.</li>
                        </ul>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => !deleteBusy && setDeleting(null)} className="px-4 py-2 text-gray-400 hover:text-white" disabled={deleteBusy}>Cancel</button>
                            <button onClick={confirmDelete} disabled={deleteBusy} className="px-5 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2">
                                {deleteBusy && <Loader2 size={14} className="animate-spin" />} {deleteBusy ? "Deleting…" : "Delete permanently"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StudentRowView({
    student, expanded, onToggle, canEdit, canDelete, onEdit, onDelete,
}: {
    student: StudentRow;
    expanded: boolean;
    onToggle: () => void;
    canEdit: boolean;
    canDelete: boolean;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
    const dash = (v: string) => (v && v.trim() ? v : "—");
    return (
        <>
            <tr className="hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                    <button onClick={onToggle} className="flex items-center gap-3 min-w-0 text-left w-full" aria-expanded={expanded} aria-label={`Details for ${student.displayName || student.email || student.uid}`}>
                        <ChevronRight size={14} className={`text-gray-600 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
                        <div className="min-w-0">
                            <p className="font-medium text-white truncate">{student.displayName || <span className="text-gray-500 italic">No name set</span>}</p>
                            <p className="text-xs text-gray-500 truncate">{student.email || student.uid}</p>
                        </div>
                    </button>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-gray-400">{dash(student.rollNo)}<span className="text-gray-600"> · </span>{dash(student.class)}{student.section ? ` · Sec ${student.section}` : ""}</td>
                <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{fmtDate(student.createdAt)}</td>
                <td className="px-4 py-3">
                    {student.isVerified
                        ? <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-400 flex items-center gap-1 w-fit"><CheckCircle2 size={10} /> Verified</span>
                        : <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/15 text-yellow-400 flex items-center gap-1 w-fit"><AlertCircle size={10} /> Pending</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && (
                        <button onClick={onEdit} className="p-2 text-gray-400 hover:text-blue-400 transition-colors" title="Edit student" aria-label={`Edit ${student.displayName || student.email || "student"}`}>
                            <Pencil size={15} />
                        </button>
                    )}
                    {canDelete && (
                        <button onClick={onDelete} className="p-2 ml-1 text-gray-500 hover:text-red-500 transition-colors" title="Delete account" aria-label={`Delete ${student.displayName || student.email || "student"}`}>
                            <Trash2 size={15} />
                        </button>
                    )}
                    {!canEdit && !canDelete && <span className="text-xs text-gray-600 italic">View only</span>}
                </td>
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={5} className="px-4 pb-5 bg-black/20">
                        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 text-sm pt-2">
                            <Detail label="Name" value={dash(student.displayName)} />
                            <Detail label="Email" value={dash(student.email)} mono />
                            <Detail label="Account ID (uid)" value={student.uid} mono />
                            <Detail label="Roll Number" value={dash(student.rollNo)} />
                            <Detail label="Department" value={dash(student.class)} />
                            <Detail label="Section" value={dash(student.section)} />
                            <Detail label="Mobile" value={dash(student.mobile)} />
                            <Detail label="Hosteller" value={student.hosteller ? "Yes" : "No"} />
                            <Detail label="Account created" value={fmtDate(student.createdAt)} />
                            <Detail label="Registration status" value={student.isVerified ? "Verified" : "Not yet verified"} />
                        </dl>
                    </td>
                </tr>
            )}
        </>
    );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wider text-gray-600">{label}</dt>
            <dd className={`text-gray-300 break-words ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
        </div>
    );
}

function Field({ label, id, error, hint, children }: { label: string; id: string; error?: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label htmlFor={id} className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
            {children}
            {error && <p role="alert" className="text-red-400 text-xs mt-1">{error}</p>}
            {!error && hint && <p className="text-gray-600 text-xs mt-1">{hint}</p>}
        </div>
    );
}
