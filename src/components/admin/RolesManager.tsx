"use client";

import { useCallback, useMemo, useState } from "react";
import { saveRole, deleteRole } from "@/lib/api";
import { ClubRole, CTO_ROLE, DEFAULT_ROLE_ID, EX_CORE_ROLE, roleIdFromLabel, reorderRoles } from "@/lib/roles";
import { permissionsByGroup, PERMISSIONS, resolveRolePermissions } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import {
    Plus, Save, Trash2, Layers, GripVertical, X, SlidersHorizontal, Check, Search,
    Terminal, Zap, Briefcase, ArrowUp, ArrowDown, Shield, History,
} from "lucide-react";

interface RolesManagerProps {
    roles: ClubRole[];
    holderCount: (roleId: string) => number;
    actorUid?: string;
    actorName?: string;
    canReorder?: boolean;
}

const inputClass = "bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none focus:ring-1 focus:ring-blue-500/40 transition-colors";
const toggleClass = "relative inline-flex w-9 h-5 rounded-full border border-white/20 p-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500";

const parseLimit = (value: string) => (value.trim() === "" ? null : Math.max(1, parseInt(value, 10) || 1));

const roleIcon = (role: ClubRole) => {
    if (role.id === CTO_ROLE.id) return <Terminal size={16} className="text-red-400" />;
    if (role.id === EX_CORE_ROLE.id) return <History size={16} className="text-purple-400" />;
    if (role.id === DEFAULT_ROLE_ID) return <Zap size={16} className="text-orange-400" />;
    return <Briefcase size={16} className="text-gray-400" />;
};

export default function RolesManager({ roles, holderCount, actorUid, actorName, canReorder = true }: RolesManagerProps) {
    const toast = useToast();
    const [drafts, setDrafts] = useState<Record<string, { label: string; description: string; limit: string }>>({});
    const [newRole, setNewRole] = useState({ name: "", description: "", limit: "1" });
    const [dragId, setDragId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
    const [permSearch, setPermSearch] = useState("");
    const [savingRole, setSavingRole] = useState(false);
    const [savingPerm, setSavingPerm] = useState(false);
    // A reorder rewrites the rank of every role, so it is one logical save: the
    // list locks itself while it is in flight instead of letting a second drop
    // race it and persist a half-applied order.
    const [savingOrder, setSavingOrder] = useState(false);

    const ordered = useMemo(() => [...roles].sort((a, b) => a.rank - b.rank), [roles]);

    // Keep a valid selection.
    const selectedRole = useMemo(() => {
        const id = selectedRoleId && ordered.some(r => r.id === selectedRoleId) ? selectedRoleId : ordered[0]?.id ?? null;
        return id ? ordered.find(r => r.id === id) ?? null : null;
    }, [ordered, selectedRoleId]);

    const draftFor = (r: ClubRole) => drafts[r.id] ?? { label: r.label, description: r.description || "", limit: r.limit === null ? "" : String(r.limit) };
    const setDraft = (r: ClubRole, patch: Partial<{ label: string; description: string; limit: string }>) =>
        setDrafts(d => ({ ...d, [r.id]: { ...draftFor(r), ...patch } }));

    const hasDraft = (r: ClubRole) => !!drafts[r.id];

    const run = async (action: () => Promise<void>, success: string) => {
        try {
            await action();
            toast.success(success);
        } catch (e: any) {
            toast.error(e?.message || "Something went wrong.");
        }
    };

    const handleSave = async (r: ClubRole) => {
        const d = draftFor(r);
        const limit = r.id === DEFAULT_ROLE_ID ? null : parseLimit(d.limit);
        if (limit !== null && holderCount(r.id) > limit) {
            toast.error(`${holderCount(r.id)} people already hold ${r.label}. Move someone out first.`);
            return;
        }
        setSavingRole(true);
        try {
            await saveRole({ id: r.id, label: d.label, description: d.description, rank: r.rank, limit }, actorUid, actorName);
            setDrafts(({ [r.id]: _, ...rest }) => rest);
            toast.success("Role saved");
        } catch (e: any) {
            toast.error(e?.message || "Could not save role.");
        } finally {
            setSavingRole(false);
        }
    };

    const handleCancelDraft = (r: ClubRole) => {
        setDrafts(({ [r.id]: _, ...rest }) => rest);
    };

    const handleDelete = (r: ClubRole) => {
        if (!confirm(`Delete the ${r.label} role? This cannot be undone.`)) return;
        run(() => deleteRole(r.id, actorUid, actorName), "Role deleted");
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        const id = roleIdFromLabel(newRole.name);
        if (!id) return toast.error("Give the role a name.");
        if (roles.some(r => r.id === id)) return toast.error("A role with that name already exists.");
        if (!canReorder) return toast.error("Only the CTO can add roles.");
        setSavingRole(true);
        try {
            await saveRole({ id, label: newRole.name, description: newRole.description, rank: 10, limit: parseLimit(newRole.limit) }, actorUid, actorName);
            setNewRole({ name: "", description: "", limit: "1" });
            setSelectedRoleId(id);
            toast.success("Role added");
        } catch (e: any) {
            toast.error(e?.message || "Could not add role.");
        } finally {
            setSavingRole(false);
        }
    };

    const commitReorder = async (nextOrder: ClubRole[]) => {
        if (!canReorder || savingOrder) return;
        const changed = nextOrder.filter(next => {
            const prev = roles.find(r => r.id === next.id);
            return prev && prev.rank !== next.rank;
        });
        if (changed.length === 0) return;
        setSavingOrder(true);
        try {
            await Promise.all(changed.map(next =>
                saveRole({ id: next.id, label: next.label, description: next.description, rank: next.rank, limit: next.limit }, actorUid, actorName)
            ));
            toast.success("Role order saved");
        } catch (e: any) {
            toast.error(e?.message || "Could not save the new order — the order was not changed.");
        } finally {
            setSavingOrder(false);
        }
    };

    const handleDrop = (targetId: string) => {
        if (savingOrder || !dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
        const nextOrder = reorderRoles(roles, dragId, targetId);
        setDragId(null);
        setDragOverId(null);
        commitReorder(nextOrder);
    };

    const moveRole = (id: string, direction: -1 | 1) => {
        if (!canReorder) return;
        const idx = ordered.findIndex(r => r.id === id);
        const targetIdx = idx + direction;
        if (idx < 0 || targetIdx < 0 || targetIdx >= ordered.length) return;
        const targetId = ordered[targetIdx].id;
        const nextOrder = reorderRoles(roles, id, targetId);
        commitReorder(nextOrder);
    };

    // ---------- Permission editor (inline in detail panel) ----------
    const currentPerms = useMemo(() => selectedRole ? new Set(resolveRolePermissions(selectedRole)) : new Set<string>(), [selectedRole]);
    const searched = permSearch.trim().toLowerCase();
    const isExCoreRole = selectedRole?.id === EX_CORE_ROLE.id;
    // Ex-Core accounts must never gain permissions; the role is fixed in code.
    const isProtectedRole = isExCoreRole;

    const togglePermission = (id: string) => {
        if (!selectedRole) return;
        const next = new Set(currentPerms);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSavingPerm(true);
        saveRole({
            id: selectedRole.id,
            label: selectedRole.label,
            description: selectedRole.description,
            rank: selectedRole.rank,
            limit: selectedRole.limit,
            permissions: [...next],
        }, actorUid, actorName)
            .then(() => toast.success("Permission updated"))
            .catch(e => toast.error(e?.message || "Permission change failed."))
            .finally(() => setSavingPerm(false));
    };

    const groupedPerms = useMemo(() => permissionsByGroup().map(group => {
        const items = group.items.filter(p => !searched ||
            p.id.toLowerCase().includes(searched) ||
            p.label.toLowerCase().includes(searched) ||
            p.description.toLowerCase().includes(searched));
        return { group: group.group, items };
    }).filter(g => g.items.length > 0), [searched]);

    const totalPermCount = currentPerms.size;

    return (
        <div className="mt-10" data-testid="club-roles-manager">
            {/* Section heading */}
            <div className="mb-6">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Layers size={18} className="text-purple-400" /> Club Roles
                </h2>
                <p className="mt-1 text-sm text-gray-400 max-w-2xl">
                    Define the club&apos;s roles, their permissions, and how they appear on the team pages.
                    <strong className="text-gray-300"> Activators</strong> have the lowest precedence and apply the
                    best-matching rules automatically; <strong className="text-gray-300"> core roles</strong> are the
                    primary club roles. Precedence and permissions are independent — reordering a role changes where it
                    appears, never what it can do.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                    Drag the handle (or use the arrows) to reorder. Changes persist immediately for the CTO.
                </p>
            </div>

            {/* Master-detail layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
                {/* Role list */}
                <aside className="space-y-2" aria-label="Club roles in precedence order">
                    <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Roles</span>
                        <span className="text-xs text-gray-600" role="status">
                            {savingOrder ? "Saving order…" : `${ordered.length} total`}
                        </span>
                    </div>

                    <ul className="space-y-1.5" role="list">
                        {ordered.map((role, idx) => {
                            const isSelected = selectedRole?.id === role.id;
                            const isDragged = dragId === role.id;
                            const isDropTarget = dragOverId === role.id && dragId !== role.id;
                            const perms = resolveRolePermissions(role).length;
                            const holders = holderCount(role.id);
                            return (
                                <li
                                    key={role.id}
                                    draggable={canReorder}
                                    onDragStart={(e) => { if (!canReorder || savingOrder) { e.preventDefault(); return; } setDragId(role.id); }}
                                    onDragOver={(e) => { if (canReorder && dragId) { e.preventDefault(); setDragOverId(role.id); } }}
                                    onDragLeave={() => setDragOverId(prev => (prev === role.id ? null : prev))}
                                    onDrop={(e) => { e.preventDefault(); handleDrop(role.id); }}
                                    onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                                    className={`group flex items-stretch rounded-lg border transition-all
                                        ${isSelected ? "border-purple-500/40 bg-purple-500/5" : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"}
                                        ${isDragged ? "opacity-40" : ""}
                                        ${isDropTarget ? "ring-2 ring-purple-400/60" : ""}`}
                                >
                                    {canReorder && (
                                        <span
                                            className={`flex flex-col items-center justify-center gap-0.5 w-9 shrink-0 border-r border-white/5 text-gray-600 ${savingOrder ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
                                            title={`Position ${idx + 1} of ${ordered.length} — drag to reorder`}
                                            aria-hidden="true"
                                        >
                                            <GripVertical size={13} />
                                            <span className="text-[10px] font-mono leading-none tabular-nums">{idx + 1}</span>
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => { setSelectedRoleId(role.id); setPermSearch(""); }}
                                        className="flex-1 text-left px-3 py-2.5 min-w-0"
                                        aria-current={isSelected ? "true" : undefined}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="shrink-0">{roleIcon(role)}</span>
                                            <span className="font-medium text-sm text-white truncate">{role.label}</span>
                                            {role.id === CTO_ROLE.id && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 shrink-0">protected</span>
                                            )}
                                            {role.id === EX_CORE_ROLE.id && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 shrink-0">no permissions</span>
                                            )}
                                        </div>
                                        {role.description && (
                                            <p className="mt-0.5 text-xs text-gray-500 truncate">{role.description}</p>
                                        )}
                                        <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-600">
                                            <span>{holders} {holders === 1 ? "holder" : "holders"}</span>
                                            <span>{perms} perms</span>
                                        </div>
                                    </button>
                                    {canReorder && (
                                        // Always visible: the arrows are the keyboard/touch path
                                        // to reorder, so they cannot be hover-only.
                                        <div className="flex flex-col justify-center gap-0.5 pr-1.5">
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); moveRole(role.id, -1); }}
                                                disabled={idx === 0 || savingOrder}
                                                aria-label={`Move ${role.label} up`}
                                                className="p-0.5 rounded text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                <ArrowUp size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); moveRole(role.id, 1); }}
                                                disabled={idx === ordered.length - 1 || savingOrder}
                                                aria-label={`Move ${role.label} down`}
                                                className="p-0.5 rounded text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                <ArrowDown size={12} />
                                            </button>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>

                    {/* Add role */}
                    {canReorder && (
                        <form onSubmit={handleAdd} className="mt-3 pt-3 border-t border-white/8 space-y-2">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Add role</p>
                            <input
                                aria-label="New role name"
                                className={inputClass + " w-full"}
                                placeholder="Role name, e.g. Events Lead"
                                value={newRole.name}
                                onChange={e => setNewRole({ ...newRole, name: e.target.value })}
                            />
                            <input
                                aria-label="New role description"
                                className={inputClass + " w-full"}
                                placeholder="Brief description of the role's purpose"
                                value={newRole.description}
                                onChange={e => setNewRole({ ...newRole, description: e.target.value })}
                            />
                            <div className="flex gap-2">
                                <input
                                    aria-label="New role seats"
                                    inputMode="numeric"
                                    className={inputClass + " w-24"}
                                    placeholder="∞ seats"
                                    value={newRole.limit}
                                    onChange={e => setNewRole({ ...newRole, limit: e.target.value.replace(/\D/g, "") })}
                                />
                                <button
                                    type="submit"
                                    disabled={savingRole}
                                    className="flex-1 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                                >
                                    <Plus size={14} /> Add role
                                </button>
                            </div>
                        </form>
                    )}
                </aside>

                {/* Detail panel */}
                <section className="min-w-0">
                    {selectedRole ? (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-6">
                            {/* Detail header */}
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="shrink-0 w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                                        {roleIcon(selectedRole)}
                                    </span>
                                    <div className="min-w-0">
                                        <h3 className="text-base font-semibold text-white truncate">{selectedRole.label}</h3>
                                        <p className="text-xs text-gray-500">
                                            {holderCount(selectedRole.id)} {holderCount(selectedRole.id) === 1 ? "holder" : "holders"}
                                            {" · "}
                                            {resolveRolePermissions(selectedRole).length} permissions
                                            {selectedRole.id === CTO_ROLE.id && " · protected"}
                                        </p>
                                    </div>
                                </div>
                                {selectedRole.id !== CTO_ROLE.id && selectedRole.id !== DEFAULT_ROLE_ID && selectedRole.id !== EX_CORE_ROLE.id && (
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(selectedRole)}
                                        className="shrink-0 p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                        title="Delete role"
                                        aria-label={`Delete ${selectedRole.label}`}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>

                            {/* Role details form */}
                            <div className="space-y-3">
                                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Role details</p>
                                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
                                    <label className="block">
                                        <span className="text-xs text-gray-500 mb-1 block">Name</span>
                                        <input
                                            aria-label="Role name"
                                            className={inputClass + " w-full"}
                                            value={draftFor(selectedRole).label}
                                            onChange={e => setDraft(selectedRole, { label: e.target.value })}
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs text-gray-500 mb-1 block">Seats</span>
                                        <input
                                            aria-label="Role seats"
                                            inputMode="numeric"
                                            className={inputClass + " w-full"}
                                            placeholder="∞"
                                            disabled={selectedRole.id === DEFAULT_ROLE_ID}
                                            value={draftFor(selectedRole).limit}
                                            onChange={e => setDraft(selectedRole, { limit: e.target.value.replace(/\D/g, "") })}
                                        />
                                    </label>
                                </div>
                                <label className="block">
                                    <span className="text-xs text-gray-500 mb-1 block">Description</span>
                                    <textarea
                                        aria-label="Role description"
                                        rows={2}
                                        className={inputClass + " w-full resize-none"}
                                        placeholder="What this role is responsible for"
                                        value={draftFor(selectedRole).description}
                                        onChange={e => setDraft(selectedRole, { description: e.target.value })}
                                    />
                                </label>
                                {hasDraft(selectedRole) && (
                                    <div className="flex items-center gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => handleSave(selectedRole)}
                                            disabled={savingRole}
                                            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                                        >
                                            <Save size={14} /> {savingRole ? "Saving…" : "Save changes"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCancelDraft(selectedRole)}
                                            disabled={savingRole}
                                            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Permissions */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                                        Permissions
                                        <span className="ml-2 normal-case text-gray-600 font-normal">
                                            {`${totalPermCount} of ${PERMISSIONS.length} enabled`}

                                        </span>
                                    </p>
                                    {!isProtectedRole && (
                                        <span className="text-[11px] text-gray-600">Changes save immediately</span>
                                    )}
                                </div>

                                {!isProtectedRole && (
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                                        <input
                                            type="search"
                                            aria-label="Search permissions"
                                            placeholder="Search permissions…"
                                            value={permSearch}
                                            onChange={e => setPermSearch(e.target.value)}
                                            className={inputClass + " w-full pl-9"}
                                        />
                                    </div>
                                )}

                                <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                                    {isProtectedRole ? (
                                        <div className="flex items-center gap-2 text-sm text-gray-400 bg-white/[0.03] border border-white/8 rounded-lg p-3">
                                            <Shield size={14} className="text-purple-400" />
                                            Ex-Core accounts hold no permissions. Restoring an account to the Active Team gives it back the default Activator role.
                                        </div>
                                    ) : groupedPerms.length === 0 ? (
                                        <p className="text-xs text-gray-500 text-center py-6">No matching permissions.</p>
                                    ) : (
                                        groupedPerms.map(group => (
                                            <div key={group.group} className="space-y-1.5">
                                                <h4 className="text-xs font-medium text-gray-400 px-1">{group.group}</h4>
                                                <div className="space-y-1">
                                                    {group.items.map(p => {
                                                        const on = currentPerms.has(p.id);
                                                        return (
                                                            <label
                                                                key={p.id}
                                                                className="flex items-start justify-between gap-3 p-2.5 rounded-lg border border-white/8 bg-black/20 hover:border-white/15 transition-colors cursor-pointer"
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-baseline gap-2 flex-wrap">
                                                                        <span className="text-sm text-gray-200">{p.label}</span>
                                                                        <code className="text-[11px] text-gray-500 font-mono">{p.id}</code>
                                                                    </div>
                                                                    <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    role="switch"
                                                                    aria-checked={on}
                                                                    aria-label={on ? `Disable ${p.label}` : `Enable ${p.label}`}
                                                                    disabled={savingPerm}
                                                                    onClick={() => togglePermission(p.id)}
                                                                    className={`${toggleClass} ${on ? "bg-blue-600 border-blue-600" : "bg-black/40"} shrink-0 mt-0.5 disabled:opacity-50`}
                                                                >
                                                                    <span
                                                                        className={`block w-4 h-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0"}`}
                                                                    />
                                                                </button>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-gray-500">
                            Select a role to configure it.
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
