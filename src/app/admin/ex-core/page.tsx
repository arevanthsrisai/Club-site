"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
    AdminProfile, subscribeToAllAdmins, subscribeToRoles,
} from "@/lib/api";
import { ClubRole, withBuiltIns, EX_CORE_ROLE } from "@/lib/roles";
import {
    ExCoreMember, ExCoreRoleEntry, globalDisplayOrder,
    latestRoleLabel, normalizeRoleEntry, normalizeYear, sanitizeRoleHistory,
    tenureLabel, academicYearLabel,
} from "@/lib/excore";
import { subscribeToExCoreMembers } from "@/services/excore";
import { getAuthHeaders } from "@/lib/authHeaders";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import {
    History, Plus, Trash2, Edit3, X, Save, ChevronUp, ChevronDown,
    Users, UserPlus, ArrowLeftRight, Linkedin, Github, Instagram, Loader2,
} from "lucide-react";

/**
 * CTO-only Ex-Core manager. All writes go through the secured server API
 * (/api/ex-core*), which authorizes against the verified ID token — the
 * permissions the server checks (isCTO or excore.manage) are echoed here as
 * UI gating only; the sidebar hides this page for non-CTO roles.
 *
 * A member's core tenure lives entirely in their role-history entries:
 * each entry records a role with the academic-year start of its FIRST and
 * LAST year (a two-year tenure spans both of its years, from this single
 * profile). There is no separate Ex-Core batch year anymore.
 */

interface RoleHistoryRow { start: string; end: string; role: string }

const DEFAULT_ROLE_ROW = (): RoleHistoryRow => {
    const y = String(new Date().getFullYear());
    return { start: y, end: String(Number(y) + 1), role: "" }; // two-year tenure by default
};

const EMPTY_ADD = {
    sourceAdminUid: "",
    name: "",
    memberType: "core" as "core" | "activator",
    history: [DEFAULT_ROLE_ROW()],
};

const EMPTY_EDIT = {
    id: "",
    name: "",
    memberType: "core" as "core" | "activator",
    bio: "",
    linkedin: "",
    github: "",
    instagram: "",
    history: [] as RoleHistoryRow[],
};

function toRows(history: ExCoreRoleEntry[] | ExCoreMember["roleHistory"] | null | undefined): RoleHistoryRow[] {
    return (history ?? [])
        .map(e => normalizeRoleEntry(e))
        .filter((e): e is ExCoreRoleEntry => e !== null)
        .map(e => ({ start: String(e.startYear), end: String(e.endYear), role: e.role }));
}

function validRows(rows: RoleHistoryRow[]): ExCoreRoleEntry[] | null {
    // Server shapes it the same way: strip invalid rows, dedupe, sort.
    return sanitizeRoleHistory(rows.map(r => ({ startYear: r.start, endYear: r.end, role: r.role })));
}

export default function AdminExCorePage() {
    const [members, setMembers] = useState<ExCoreMember[]>([]);
    const [admins, setAdmins] = useState<AdminProfile[]>([]);
    const [roles, setRoles] = useState<ClubRole[]>(withBuiltIns([]));
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    // Add form
    const [showAdd, setShowAdd] = useState(false);
    const [addForm, setAddForm] = useState(EMPTY_ADD);
    const [saving, setSaving] = useState(false);

    // Edit dialog
    const [editForm, setEditForm] = useState<typeof EMPTY_EDIT | null>(null);

    // Ordering: one global pending sequence for all members
    const [orderDirty, setOrderDirty] = useState(false);
    const [bumping, setBumping] = useState(false);

    useEffect(() => {
        const unsubMembers = subscribeToExCoreMembers(data => {
            setMembers(data);
            setLoading(false);
        });
        const unsubAdmins = subscribeToAllAdmins(setAdmins);
        const unsubRoles = subscribeToRoles(setRoles);
        return () => { unsubMembers(); unsubAdmins(); unsubRoles(); };
    }, []);


    // Team accounts that can be moved into Ex-Core (active, still on the team).
    const movableAccounts = useMemo(
        () => admins
            .filter(u =>
                u.status === "active" &&
                u.role !== "pending" &&
                !u.exCoreAt &&
                u.role !== "CTO" &&            // the CTO account can never move under Ex-Core
                u.role !== EX_CORE_ROLE.id &&   // freshly moved accounts are no longer movable
                u.uid !== undefined)
            .sort((a, b) =>
                (a.displayName || a.email).localeCompare(b.displayName || b.email)),
        [admins],
    );

    // One global, persisted sequence; rows render in this order.
    const orderedMembers = useMemo(() => {
        const insertion = new Map(members.map((m, i) => [m.id, i] as const));
        return [...members].sort((a, b) =>
            (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
            (insertion.get(a.id)! - insertion.get(b.id)!));
    }, [members]);

    const moveMember = useCallback((memberId: string, dir: -1 | 1) => {
        setMembers(prev => {
            const ids = globalDisplayOrder(prev);
            const pos = ids.indexOf(memberId);
            const target = pos + dir;
            if (pos < 0 || target < 0 || target >= ids.length) return prev;
            const next = ids.slice();
            const [moved] = next.splice(pos, 1);
            next.splice(target, 0, moved);
            const order = new Map(next.map((id, i) => [id, i] as const));
            return prev.map(m => {
                const ni = order.get(m.id);
                return ni === undefined ? m : { ...m, displayOrder: ni };
            });
        });
        setOrderDirty(true);
    }, []);

    const saveOrder = async () => {
        const order = globalDisplayOrder(members);
        if (order.length === 0) return;
        setBumping(true);
        try {
            const res = await fetch("/api/ex-core/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                body: JSON.stringify({ order }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast(json.error || "Failed to save the ordering.", "error");
                return;
            }
            setOrderDirty(false);
            toast("Ordering saved — all devices will see this sequence.", "success");
        } catch (err) {
            console.error(err);
            toast("Failed to save the ordering.", "error");
        } finally {
            setBumping(false);
        }
    };

    const handleAdd = async () => {
        if (!addForm.sourceAdminUid && !addForm.name.trim()) {
            toast("Choose a team account to move, or enter a name for a standalone member.", "error");
            return;
        }
        const history = validRows(addForm.history);
        if (!history) {
            toast("Add the tenure: a role with its start and end year (e.g. 2026 → 2028 = 2026–2028).", "error");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/ex-core", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                body: JSON.stringify({
                    sourceAdminUid: addForm.sourceAdminUid || undefined,
                    name: addForm.name.trim() || undefined,
                    memberType: addForm.memberType,
                    roleHistory: history,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast(json.error || "Failed to add the member.", "error");
                return;
            }
            toast(addForm.sourceAdminUid
                ? `${addForm.sourceAdminUid} moved into Ex-Core. They can now self-edit their Ex-Core profile.`
                : "Standalone member added to Ex-Core.", "success");
            setAddForm(EMPTY_ADD);
            setShowAdd(false);
        } catch (err) {
            console.error(err);
            toast("Failed to add the member.", "error");
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (m: ExCoreMember) => {
        setEditForm({
            id: m.id,
            name: m.name || "",
            memberType: m.memberType === "activator" ? "activator" : "core",
            bio: m.bio ?? "",
            linkedin: m.socials?.linkedin ?? "",
            github: m.socials?.github ?? "",
            instagram: m.socials?.instagram ?? "",
            history: toRows(m.roleHistory),
        });
    };

    const handleEditSave = async () => {
        if (!editForm) return;
        if (!editForm.name.trim()) { toast("A name is required.", "error"); return; }
        setSaving(true);
        try {
            const res = await fetch("/api/ex-core", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                body: JSON.stringify({
                    id: editForm.id,
                    name: editForm.name.trim(),
                    memberType: editForm.memberType,
                    bio: editForm.bio,
                    socials: {
                        linkedin: editForm.linkedin,
                        github: editForm.github,
                        instagram: editForm.instagram,
                    },
                    roleHistory: validRows(editForm.history) ?? [],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { toast(json.error || "Failed to save changes.", "error"); return; }
            toast("Profile updated.", "success");
            setEditForm(null);
        } catch (err) {
            console.error(err);
            toast("Failed to save changes.", "error");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (m: ExCoreMember) => {
        if (!confirm(`Remove ${m.name} from Ex-Core?${m.linkedUserId ? " Their admin account returns to the team listings." : ""}`)) return;
        try {
            const res = await fetch("/api/ex-core", {
                method: "DELETE",
                headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                body: JSON.stringify({ id: m.id }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { toast(json.error || "Failed to remove.", "error"); return; }
            toast(`${m.name} removed from Ex-Core.`, "success");
        } catch (err) {
            console.error(err);
            toast("Failed to remove.", "error");
        }
    };

    const roleOptions = useMemo(
        () => roles.map(r => (r as ClubRole).label).sort((a, b) => a.localeCompare(b)),
        [roles],
    );

    const renderHistoryRows = (
        rows: RoleHistoryRow[],
        setRows: (update: (rows: RoleHistoryRow[]) => RoleHistoryRow[]) => void,
        required: boolean,
    ) => (
        <div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Role history {required ? "" : "(optional)"}
                </span>
                <button
                    type="button"
                    onClick={() => setRows(prev => [...prev, DEFAULT_ROLE_ROW()])}
                    className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                >
                    <Plus size={12} /> Add tenure
                </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
                Start and end are academic-year starts: 2026 → 2028 means the two-year 2026–27 and 2027–28 tenure. The member is displayed in both of those years.
            </p>
            <div className="mt-2 space-y-2">
                {rows.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                        <input
                            type="number"
                            min={2000}
                            max={2100}
                            value={row.start}
                            onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, start: e.target.value } : r))}
                            placeholder="Start"
                            className="w-24 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            aria-label={`Tenure start year ${i + 1}`}
                        />
                        <input
                            type="number"
                            min={2000}
                            max={2100}
                            value={row.end}
                            onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, end: e.target.value } : r))}
                            placeholder="End"
                            className="w-24 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            aria-label={`Tenure end year ${i + 1}`}
                        />
                        <input
                            type="text"
                            list="role-history-opts"
                            value={row.role}
                            onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, role: e.target.value } : r))}
                            placeholder="Role held (e.g. CTO)"
                            className="flex-1 min-w-[160px] bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            aria-label={`Role held ${i + 1}`}
                        />
                        <button
                            type="button"
                            onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}
                            className="text-gray-500 hover:text-red-400 p-2"
                            aria-label={`Remove tenure entry ${i + 1}`}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>
            <datalist id="role-history-opts">
                {roleOptions.map(r => <option key={r} value={r} />)}
            </datalist>
        </div>
    );

    return (
        <div className="pb-12">
            <PageHeader
                title="Ex-Core"
                subtitle="Former Core members and Activators, by the tenure recorded in their role history. Public page: /ex-core"
                icon={<History size={26} />}
            />

            {loading ? (
                <div className="py-16 flex justify-center">
                    <Loader2 className="animate-spin text-blue-400" size={28} aria-hidden="true" />
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3 mb-6">
                        <button
                            type="button"
                            onClick={() => { setShowAdd(v => !v); setAddForm(EMPTY_ADD); }}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                            {showAdd ? <X size={16} /> : <Plus size={16} />}
                            {showAdd ? "Cancel" : "Add to Ex-Core"}
                        </button>
                        <p className="text-xs text-gray-500">
                            {members.length} member{members.length === 1 ? "" : "s"}
                        </p>
                        {orderDirty && (
                            <button
                                type="button"
                                onClick={saveOrder}
                                disabled={bumping}
                                className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50"
                            >
                                <Save size={14} /> Save new order
                            </button>
                        )}
                    </div>

                    {/* ADD FORM */}
                    {showAdd && (
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-8 space-y-4 max-w-2xl">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Move a team account (recommended)</span>
                                    <select
                                        value={addForm.sourceAdminUid}
                                        onChange={e => setAddForm(f => ({ ...f, sourceAdminUid: e.target.value }))}
                                        className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    >
                                        <option value="">— No, standalone member —</option>
                                        {movableAccounts.map(a => (
                                            <option key={a.uid} value={a.uid}>{a.displayName || a.email}</option>
                                        ))}
                                    </select>
                                    <span className="text-[11px] text-gray-500 mt-1 block">
                                        Keeps their sign-in; the profile appears on /ex-core and leaves the team listings. The member can self-edit it afterwards.
                                    </span>
                                </label>

                                <label className="block">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Or standalone name</span>
                                    <input
                                        type="text"
                                        value={addForm.name}
                                        onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                                        disabled={!!addForm.sourceAdminUid}
                                        placeholder="Someone with no admin account"
                                        className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                </label>
                            </div>

                            <label className="block">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Member category</span>
                                <select
                                    value={addForm.memberType}
                                    onChange={e => setAddForm(f => ({ ...f, memberType: e.target.value as "core" | "activator" }))}
                                    className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                >
                                    <option value="core">Core member</option>
                                    <option value="activator">Activator</option>
                                </select>
                            </label>

                            {renderHistoryRows(
                                addForm.history,
                                update => setAddForm(f => ({ ...f, history: update(f.history) })),
                                true,
                            )}

                            <button
                                type="button"
                                onClick={handleAdd}
                                disabled={saving}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold transition-colors"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                                Add member
                            </button>
                        </div>
                    )}

                    {/* MEMBER LIST (one global persisted order) */}
                    {orderedMembers.length === 0 ? (
                        <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
                            <Users size={36} className="mx-auto text-gray-600 mb-4" aria-hidden="true" />
                            <p className="text-gray-400 font-medium">No Ex-Core members yet.</p>
                            <p className="text-gray-600 text-sm mt-1">Use “Add to Ex-Core” to move a team account here or add a standalone member.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {orderedMembers.map((m, i) => {
                                const history = toRows(m.roleHistory);
                                return (
                                    <div
                                        key={m.id}
                                        className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 hover:border-white/20 transition-colors"
                                    >
                                        {/* Reorder controls */}
                                        <div className="flex flex-col shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => moveMember(m.id, -1)}
                                                disabled={i === 0}
                                                className="text-gray-500 hover:text-white disabled:opacity-20 p-0.5"
                                                aria-label={`Move ${String(m.name || "member")} up`}
                                            >
                                                <ChevronUp size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveMember(m.id, +1)}
                                                disabled={i === orderedMembers.length - 1}
                                                className="text-gray-500 hover:text-white disabled:opacity-20 p-0.5"
                                                aria-label={`Move ${m.name} down`}
                                            >
                                                <ChevronDown size={14} />
                                            </button>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-white truncate">
                                                {String(m.name || m.email || "Member")}
                                                {m.linkedUserId && (
                                                    <span className="ml-2 text-[10px] font-semibold text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider align-middle">
                                                        Account linked
                                                    </span>
                                                )}
                                            </p>
                                            <p className="text-xs text-gray-500 truncate">
                                                {m.memberType === "activator" ? "Activator" : "Core"}
                                                {history.length > 0 && (
                                                    <> · {history.map(r => `${tenureLabel(r.start, r.end)} ${r.role}`).join(", ")}</>
                                                )}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => openEdit(m)}
                                                className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
                                                aria-label={`Edit ${String(m.name || "member")}`}
                                            >
                                                <Edit3 size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(m)}
                                                className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                                                aria-label={`Remove ${String(m.name || "member")} from Ex-Core`}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            <p className="text-[11px] text-gray-600 pt-1">
                                Ordering is one global sequence; the public year sections keep this running order.
                            </p>
                        </div>
                    )}
                </>
            )}

            {/* EDIT DIALOG */}
            {editForm && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                    role="presentation"
                    onClick={() => !saving && setEditForm(null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="excore-edit-title"
                        className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl relative"
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setEditForm(null)}
                            aria-label="Close editor"
                            className="absolute top-4 right-4 text-gray-400 hover:text-white bg-black/50 p-2 rounded-full z-10"
                        >
                            <X size={18} />
                        </button>

                        <div className="p-6 space-y-4">
                            <h2 id="excore-edit-title" className="text-xl font-bold text-white">Edit Ex-Core profile</h2>

                            <label className="block">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Name</span>
                                <input
                                    type="text"
                                    value={editForm.name}
                                    onChange={e => setEditForm(f => f && { ...f, name: e.target.value })}
                                    className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                            </label>

                            <label className="block">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Member category</span>
                                <select
                                    value={editForm.memberType}
                                    onChange={e => setEditForm(f => f && { ...f, memberType: e.target.value as "core" | "activator" })}
                                    className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                >
                                    <option value="core">Core member</option>
                                    <option value="activator">Activator</option>
                                </select>
                            </label>

                            <label className="block">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Bio (public)</span>
                                <textarea
                                    rows={3}
                                    value={editForm.bio}
                                    onChange={e => setEditForm(f => f && { ...f, bio: e.target.value })}
                                    maxLength={2000}
                                    className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                            </label>

                            <div className="grid sm:grid-cols-3 gap-3">
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Linkedin size={11} /> LinkedIn</span>
                                    <input
                                        type="url"
                                        placeholder="https://linkedin.com/in/…"
                                        value={editForm.linkedin}
                                        onChange={e => setEditForm(f => f && { ...f, linkedin: e.target.value })}
                                        className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Github size={11} /> GitHub</span>
                                    <input
                                        type="url"
                                        placeholder="https://github.com/…"
                                        value={editForm.github}
                                        onChange={e => setEditForm(f => f && { ...f, github: e.target.value })}
                                        className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Instagram size={11} /> Instagram</span>
                                    <input
                                        type="url"
                                        placeholder="https://instagram.com/…"
                                        value={editForm.instagram}
                                        onChange={e => setEditForm(f => f && { ...f, instagram: e.target.value })}
                                        className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                </label>
                            </div>

                            {renderHistoryRows(
                                editForm.history,
                                update => setEditForm(f => f && { ...f, history: update(f.history) }),
                                false,
                            )}

                            <p className="text-[11px] text-gray-500">
                                Ordering is managed with the arrows on the list (then “Save new order”), not here.
                            </p>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={handleEditSave}
                                    disabled={saving}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold transition-colors"
                                >
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Edit3 size={16} />}
                                    Save changes
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditForm(null)}
                                    className="px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Owner self-edit hint (CTO's own Ex-Core card, if any) */}
            <p className="text-[11px] text-gray-600 mt-6 flex items-center gap-1.5 max-w-xl">
                <ArrowLeftRight size={12} aria-hidden="true" />
                Members with a linked account can edit their own name, photo, bio and links on Ex-Core via /api/ex-core/self — category, role history and ordering stay manager-controlled.
            </p>
        </div>
    );
}
