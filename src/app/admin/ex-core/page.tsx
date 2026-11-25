"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
    AdminProfile, subscribeToAllAdmins, subscribeToRoles,
} from "@/lib/api";
import { ClubRole, withBuiltIns, EX_CORE_ROLE } from "@/lib/roles";
import {
    ExCoreMember, academicYearLabel, memberTenureYears, tenureLabel, YEARLESS,
} from "@/lib/excore";
import { subscribeToExCoreMembers } from "@/services/excore";
import { getAuthHeaders } from "@/lib/authHeaders";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import RoleHistoryEditor, {
    RoleHistoryRow, defaultRoleHistoryRow, roleHistoryToRows, rowsToRoleHistory,
} from "@/components/admin/RoleHistoryEditor";
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

const EMPTY_ADD = {
    sourceAdminUid: "",
    name: "",
    memberType: "core" as "core" | "activator",
    history: [defaultRoleHistoryRow()],
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

/**
 * One foldable section per batch. A member's batch is their LATEST tenure
 * year (the newest academic year recorded in their role history), so a
 * two-year member is listed once here — the public page still shows them in
 * both of their year sections. Members without usable tenure fall into the
 * "Other" section at the bottom.
 */
interface BatchGroup {
    year: number;
    label: string;
    members: ExCoreMember[];
    core: number;
    activators: number;
}

function buildBatchGroups(members: ExCoreMember[]): BatchGroup[] {
    const insertedAt = new Map(members.map((m, i) => [m.id, i] as const));
    const byYear = new Map<number, ExCoreMember[]>();
    for (const m of members) {
        const years = memberTenureYears(m);
        const batch = years.length ? years[0] : YEARLESS;
        if (!byYear.has(batch)) byYear.set(batch, []);
        byYear.get(batch)!.push(m);
    }
    return [...byYear.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([year, list]) => {
            const sorted = [...list].sort((a, b) =>
                (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
                insertedAt.get(a.id)! - insertedAt.get(b.id)!);
            return {
                year,
                label: year === YEARLESS ? "Other" : academicYearLabel(year),
                members: sorted,
                core: sorted.filter(m => m.memberType !== "activator").length,
                activators: sorted.filter(m => m.memberType === "activator").length,
            };
        });
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

    // Batch sections start CLOSED; the CTO opens only the batch they need.
    const [openBatches, setOpenBatches] = useState<Record<number, boolean>>({});

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

    // Batches newest first; rows inside a batch follow the persisted order.
    const batchGroups = useMemo(() => buildBatchGroups(members), [members]);

    const moveMember = useCallback((memberId: string, dir: -1 | 1) => {
        setMembers(prev => {
            const groups = buildBatchGroups(prev);
            const group = groups.find(g => g.members.some(m => m.id === memberId));
            if (!group) return prev;
            const pos = group.members.findIndex(m => m.id === memberId);
            const target = pos + dir;
            // Ordering moves inside a batch only; batches themselves are
            // sorted newest first and are never reordered by hand.
            if (target < 0 || target >= group.members.length) return prev;
            const ids = groups.flatMap(g => g.members.map(m => m.id));
            const from = ids.indexOf(memberId);
            const to = ids.indexOf(group.members[target].id);
            if (from < 0 || to < 0) return prev;
            const next = ids.slice();
            [next[from], next[to]] = [next[to], next[from]];
            const order = new Map(next.map((id, i) => [id, i] as const));
            return prev.map(m => {
                const ni = order.get(m.id);
                return ni === undefined ? m : { ...m, displayOrder: ni };
            });
        });
        setOrderDirty(true);
    }, []);

    const saveOrder = async () => {
        const order = batchGroups.flatMap(g => g.members.map(m => m.id));
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
        const history = rowsToRoleHistory(addForm.history);
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
            const movedName = addForm.sourceAdminUid
                ? admins.find(a => a.uid === addForm.sourceAdminUid)?.displayName || "The account"
                : "";
            toast(addForm.sourceAdminUid
                ? `${movedName} moved into Ex-Core. They can now self-edit their Ex-Core settings.`
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
            history: roleHistoryToRows(m.roleHistory),
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
                    roleHistory: rowsToRoleHistory(editForm.history) ?? [],
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
                subtitle="Former Core members and Activators grouped by batch (latest tenure year). Public page: /ex-core"
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

                            <RoleHistoryEditor
                                rows={addForm.history}
                                onChange={rows => setAddForm(f => ({ ...f, history: rows }))}
                                roleOptions={roleOptions}
                                required
                            />

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

                    {/* MEMBER LIST — one foldable section per batch, newest first */}
                    {batchGroups.length === 0 ? (
                        <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
                            <Users size={36} className="mx-auto text-gray-600 mb-4" aria-hidden="true" />
                            <p className="text-gray-400 font-medium">No Ex-Core members yet.</p>
                            <p className="text-gray-600 text-sm mt-1">Use “Add to Ex-Core” to move a team account here or add a standalone member.</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <p className="text-xs text-gray-500">
                                    {members.length} member{members.length === 1 ? "" : "s"} in {batchGroups.length} batch{batchGroups.length === 1 ? "" : "es"} · newest first
                                </p>
                                <p className="text-[11px] text-gray-600">Open a batch to manage its members.</p>
                            </div>

                            <div className="space-y-3">
                                {batchGroups.map(group => {
                                    const open = !!openBatches[group.year];
                                    const panelId = `excore-batch-${group.year}`;
                                    return (
                                        <section
                                            key={group.year}
                                            className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setOpenBatches(prev => ({ ...prev, [group.year]: !prev[group.year] }))}
                                                aria-expanded={open}
                                                aria-controls={panelId}
                                                className="w-full flex flex-wrap items-center gap-3 px-4 py-3.5 text-left hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-400"
                                            >
                                                <ChevronDown
                                                    size={16}
                                                    aria-hidden="true"
                                                    className={`shrink-0 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`}
                                                />
                                                <span className="text-sm font-bold text-white">{group.label}</span>
                                                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300">
                                                    {group.members.length} member{group.members.length === 1 ? "" : "s"}
                                                </span>
                                                <span className="text-[11px] text-gray-500 ml-auto">
                                                    {group.core} core · {group.activators} activator{group.activators === 1 ? "" : "s"}
                                                </span>
                                            </button>

                                            {open && (
                                                <div id={panelId} className="border-t border-white/10 divide-y divide-white/5">
                                                    {group.members.map((m, i) => {
                                                        const history = roleHistoryToRows(m.roleHistory);
                                                        return (
                                                            <div
                                                                key={m.id}
                                                                className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
                                                            >
                                                                {/* Reorder inside this batch only */}
                                                                <div className="flex flex-col shrink-0">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => moveMember(m.id, -1)}
                                                                        disabled={i === 0}
                                                                        className="text-gray-500 hover:text-white disabled:opacity-20 p-0.5"
                                                                        aria-label={`Move ${String(m.name || "member")} up in ${group.label}`}
                                                                    >
                                                                        <ChevronUp size={14} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => moveMember(m.id, +1)}
                                                                        disabled={i === group.members.length - 1}
                                                                        className="text-gray-500 hover:text-white disabled:opacity-20 p-0.5"
                                                                        aria-label={`Move ${String(m.name || "member")} down in ${group.label}`}
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
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                            </div>

                            <p className="text-[11px] text-gray-600 pt-2">
                                A member&apos;s batch is their latest academic year; the public page still lists both years of a two-year tenure. Use the arrows to order members inside a batch, then save.
                            </p>
                        </>
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

                            <RoleHistoryEditor
                                rows={editForm.history}
                                onChange={rows => setEditForm(f => f && { ...f, history: rows })}
                                roleOptions={roleOptions}
                            />

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
                Members with a linked account control their own name, photo, bio, links, member category and role history on their Ex-Core Settings page — only ordering and account linking stay CTO-managed.
            </p>
        </div>
    );
}
