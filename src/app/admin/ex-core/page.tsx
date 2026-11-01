"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
    AdminProfile, subscribeToAllAdmins, subscribeToRoles,
} from "@/lib/api";
import { ClubRole, withBuiltIns, EX_CORE_ROLE } from "@/lib/roles";
import {
    ExCoreMember, ExCoreRoleEntry, groupByBatchDesc, batchLabel,
    academicYearLabel, normalizeYear,
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
 */

interface RoleHistoryRow { year: string; role: string }

const EMPTY_ADD = {
    sourceAdminUid: "",
    name: "",
    exCoreBatch: "",
    memberType: "core" as "core" | "activator",
    history: [] as RoleHistoryRow[],
};

const EMPTY_EDIT = {
    id: "",
    name: "",
    exCoreBatch: "",
    memberType: "core" as "core" | "activator",
    bio: "",
    linkedin: "",
    github: "",
    instagram: "",
    history: [] as RoleHistoryRow[],
};

function toRows(history: ExCoreRoleEntry[] | null | undefined): RoleHistoryRow[] {
    return (history ?? []).map(e => ({ year: String(e.year), role: e.role }));
}

function validRows(rows: RoleHistoryRow[]): ExCoreRoleEntry[] | null {
    const out = rows
        .map(r => ({ year: normalizeYear(r.year), role: r.role.trim() }))
        .filter((r): r is { year: number; role: string } => r.year !== null && r.role.length > 0);
    return out.length ? out : null;
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

    // Ordering: pending sequence changes per batch id
    const [orderDirty, setOrderDirty] = useState<Set<string>>(new Set());
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

    const batches = useMemo(() => groupByBatchDesc(members), [members]);

    const moveWithinBatch = useCallback((batchId: number, memberId: string, dir: -1 | 1) => {
        setMembers(prev => {
            const seq = prev
                .filter(m => m.exCoreBatch === batchId)
                .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
            const pos = seq.findIndex(m => m.id === memberId);
            const target = pos + dir;
            if (pos < 0 || target < 0 || target >= seq.length) return prev;
            const next = seq.slice();
            const [moved] = next.splice(pos, 1);
            next.splice(target, 0, moved);
            const newOrder = new Map(next.map((m, i) => [m.id, i] as const));
            return prev.map(m => {
                const ni = newOrder.get(m.id);
                return ni === undefined ? m : { ...m, displayOrder: ni };
            });
        });
        setOrderDirty(prev => new Set(prev).add(String(batchId)));
    }, []);

    const saveBatchOrder = async (batchId: number) => {
        const seq = members
            .filter(m => m.exCoreBatch === batchId)
            .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
        const order = seq.map(m => m.id);
        if (order.length === 0) return;
        setBumping(true);
        try {
            const res = await fetch("/api/ex-core/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                body: JSON.stringify({ batch: batchId, order }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast(json.error || "Failed to save the ordering.", "error");
                return;
            }
            setOrderDirty(prev => {
                const next = new Set(prev);
                next.delete(String(batchId));
                return next;
            });
            toast("Ordering saved — all devices will see this sequence.", "success");
        } catch (err) {
            console.error(err);
            toast("Failed to save the ordering.", "error");
        } finally {
            setBumping(false);
        }
    };

    const handleAdd = async () => {
        const batch = normalizeYear(addForm.exCoreBatch);
        if (batch === null) {
            toast("Enter a valid Ex-Core batch year (e.g. 2027 = 2027–2028).", "error");
            return;
        }
        if (!addForm.sourceAdminUid && !addForm.name.trim()) {
            toast("Choose a team account to move, or enter a name for a standalone member.", "error");
            return;
        }
        const history = validRows(addForm.history);
        setSaving(true);
        try {
            const res = await fetch("/api/ex-core", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                body: JSON.stringify({
                    sourceAdminUid: addForm.sourceAdminUid || undefined,
                    name: addForm.name.trim() || undefined,
                    exCoreBatch: batch,
                    memberType: addForm.memberType,
                    roleHistory: history ?? undefined,
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
            exCoreBatch: m.exCoreBatch != null ? String(m.exCoreBatch) : "",
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
        const batch = normalizeYear(editForm.exCoreBatch);
        if (!editForm.name.trim()) { toast("A name is required.", "error"); return; }
        if (batch === null) { toast("Enter a valid batch year.", "error"); return; }
        setSaving(true);
        try {
            const res = await fetch("/api/ex-core", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                body: JSON.stringify({
                    id: editForm.id,
                    name: editForm.name.trim(),
                    memberType: editForm.memberType,
                    exCoreBatch: batch,
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

    return (
        <div className="pb-12">
            <PageHeader
                title="Ex-Core"
                subtitle="Former Core members and Activators, grouped by batch. Public page: /ex-core"
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
                            {members.length} member{members.length === 1 ? "" : "s"} across {batches.length} batch{batches.length === 1 ? "" : "es"}
                        </p>
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

                            <div className="grid sm:grid-cols-2 gap-4">
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ex-Core batch (stepped down in)</span>
                                    <input
                                        type="number"
                                        min={2000}
                                        max={2100}
                                        value={addForm.exCoreBatch}
                                        onChange={e => setAddForm(f => ({ ...f, exCoreBatch: e.target.value }))}
                                        placeholder="e.g. 2027"
                                        className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                    <span className="text-[11px] text-gray-500 mt-1 block">Academic-year start: 2027 = the 2027–2028 batch.</span>
                                </label>

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
                            </div>

                            {/* Role history seed */}
                            <div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Role history (optional)</span>
                                    <button
                                        type="button"
                                        onClick={() => setAddForm(f => ({ ...f, history: [...f.history, { year: String(new Date().getFullYear()), role: "" }] }))}
                                        className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                                    >
                                        <Plus size={12} /> Add year
                                    </button>
                                </div>
                                {addForm.history.length === 0 && (
                                    <p className="text-[11px] text-gray-500 mt-1">The years and roles they held, newest first. Independent of the batch year.</p>
                                )}
                                <div className="mt-2 space-y-2">
                                    {addForm.history.map((row, i) => (
                                        <div key={i} className="flex gap-2 items-center">
                                            <input
                                                type="number"
                                                min={2000}
                                                max={2100}
                                                value={row.year}
                                                onChange={e => setAddForm(f => ({
                                                    ...f,
                                                    history: f.history.map((r, j) => j === i ? { ...r, year: e.target.value } : r),
                                                }))}
                                                placeholder="Year"
                                                className="w-24 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                aria-label="Role year"
                                            />
                                            <input
                                                type="text"
                                                list="role-history-opts"
                                                value={row.role}
                                                onChange={e => setAddForm(f => ({
                                                    ...f,
                                                    history: f.history.map((r, j) => j === i ? { ...r, role: e.target.value } : r),
                                                }))}
                                                placeholder="Role held (e.g. CTO)"
                                                className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                aria-label="Role held"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setAddForm(f => ({ ...f, history: f.history.filter((_, j) => j !== i) }))}
                                                className="text-gray-500 hover:text-red-400 p-2"
                                                aria-label={`Remove role entry ${i + 1}`}
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

                    {/* BATCH SECTIONS */}
                    {batches.length === 0 ? (
                        <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
                            <Users size={36} className="mx-auto text-gray-600 mb-4" aria-hidden="true" />
                            <p className="text-gray-400 font-medium">No Ex-Core members yet.</p>
                            <p className="text-gray-600 text-sm mt-1">Use “Add to Ex-Core” to move a team account here or add a standalone member.</p>
                        </div>
                    ) : (
                        batches.map(group => {
                            // On-screen sequence for this batch (custom order wins).
                            const seq = members
                                .filter(m => m.exCoreBatch === group.year)
                                .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
                            const dirty = orderDirty.has(String(group.year));
                            const typeLabel = (m: ExCoreMember) => (m.memberType === "activator" ? "Activator" : "Core");

                            return (
                                <section key={group.year} className="mb-10" aria-label={group.label}>
                                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                        <h2 className="text-xl font-bold text-blue-400">{batchLabel(group.year)}</h2>
                                        {dirty && (
                                            <button
                                                type="button"
                                                onClick={() => saveBatchOrder(group.year)}
                                                disabled={bumping}
                                                className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50"
                                            >
                                                <Save size={14} /> Save new order
                                            </button>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        {seq.map((m, i) => (
                                            <div
                                                key={m.id}
                                                className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 hover:border-white/20 transition-colors"
                                            >
                                                {/* Reorder controls */}
                                                <div className="flex flex-col shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveWithinBatch(group.year, m.id, -1)}
                                                        disabled={i === 0}
                                                        className="text-gray-500 hover:text-white disabled:opacity-20 p-0.5"
                                                        aria-label={`Move ${String(m.name || "member")} up`}
                                                    >
                                                        <ChevronUp size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveWithinBatch(group.year, m.id, +1)}
                                                        disabled={i === seq.length - 1}
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
                                                        {typeLabel(m)}
                                                        {(m.roleHistory ?? []).length > 0 && (
                                                            <> · {m.roleHistory.map(h => `${academicYearLabel(h.year)} ${h.role}`).join(", ")}</>
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
                                        ))}
                                    </div>
                                </section>
                            );
                        })
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

                            <div className="grid sm:grid-cols-2 gap-4">
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ex-Core batch</span>
                                    <input
                                        type="number"
                                        min={2000}
                                        max={2100}
                                        value={editForm.exCoreBatch}
                                        onChange={e => setEditForm(f => f && { ...f, exCoreBatch: e.target.value })}
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
                            </div>

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

                            {/* Role history edit */}
                            <div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Role history</span>
                                    <button
                                        type="button"
                                        onClick={() => setEditForm(f => f && { ...f, history: [...f.history, { year: String(new Date().getFullYear()), role: "" }] })}
                                        className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                                    >
                                        <Plus size={12} /> Add year
                                    </button>
                                </div>
                                <div className="mt-2 space-y-2">
                                    {editForm.history.map((row, i) => (
                                        <div key={i} className="flex gap-2 items-center">
                                            <input
                                                type="number"
                                                min={2000}
                                                max={2100}
                                                value={row.year}
                                                onChange={e => setEditForm(f => f && {
                                                    ...f,
                                                    history: f.history.map((r, j) => j === i ? { ...r, year: e.target.value } : r),
                                                })}
                                                placeholder="Year"
                                                className="w-24 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                aria-label="Role year"
                                            />
                                            <input
                                                type="text"
                                                list="role-history-opts"
                                                value={row.role}
                                                onChange={e => setEditForm(f => f && {
                                                    ...f,
                                                    history: f.history.map((r, j) => j === i ? { ...r, role: e.target.value } : r),
                                                })}
                                                placeholder="Role held"
                                                className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                aria-label="Role held"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setEditForm(f => f && { ...f, history: f.history.filter((_, j) => j !== i) })}
                                                className="text-gray-500 hover:text-red-400 p-2"
                                                aria-label={`Remove role entry ${i + 1}`}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {editForm.id === "" ? null : (
                                <p className="text-[11px] text-gray-500">
                                    Ordering is managed with the arrows on the list (then “Save new order”), not here.
                                </p>
                            )}

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
                Members with a linked account can edit their own name, photo, bio and links on Ex-Core via /api/ex-core/self — batch, category, role history and ordering stay manager-controlled.
            </p>
        </div>
    );
}
