"use client";

import { useEffect, useState } from "react";
import { getAllAdmins, deleteAdmin, AdminProfile, PendingRegistration, getPendingRegistrations, approveRegistration, rejectRegistration, subscribeToAllAdmins, subscribeToPendingRegistrations, logActivity, updateAdminRole, createAdminDirectly, replaceRoleHolder, subscribeToRoles, seedDefaultRoles } from "@/lib/api";
import { getAuthHeaders } from "@/lib/authHeaders";
import { ClubRole, CTO_ROLE, DEFAULT_ROLE_ID, roleLabel, withBuiltIns, sortMembersByRole } from "@/lib/roles";
import { normalizeEmail } from "@/lib/normalizeEmail";
import RolesManager from "@/components/admin/RolesManager";
import { useAuth } from "@/lib/auth";
import { Check, X, Shield, Trash2, User, Users, Tag, Pencil, Search } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import PageHeader from "@/components/ui/PageHeader";
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator";

export default function AdminUsersPage() {
    const { profile } = useAuth();
    const toast = useToast();
    const [admins, setAdmins] = useState<AdminProfile[]>([]);
    const [pendingRegs, setPendingRegs] = useState<PendingRegistration[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingAdmin, setEditingAdmin] = useState<AdminProfile | null>(null);
    const [roles, setRoles] = useState<ClubRole[]>(withBuiltIns([]));
    // Set when a role change needs someone moved out of a full role first.
    const [replacing, setReplacing] = useState<{ target: AdminProfile; role: ClubRole; holders: AdminProfile[]; replacedUid: string } | null>(null);

    // New State for Create Modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createForm, setCreateForm] = useState({ email: "", password: "", role: "Activator" });

    // Nickname editing (CTO-only; the API re-checks server-side)
    const [nickTarget, setNickTarget] = useState<AdminProfile | null>(null);
    const [nickValue, setNickValue] = useState("");
    const [nickError, setNickError] = useState("");
    const [nickBusy, setNickBusy] = useState(false);
    const [nickInitial, setNickInitial] = useState<string | undefined>(undefined);
    // Admin list search: finds by nickname OR email (normalized) or name/uid.
    const [adminSearchInput, setAdminSearchInput] = useState("");

    const adminSearch = normalizeEmail(adminSearchInput) || adminSearchInput.trim().toLowerCase();

    const openNicknameEditor = (admin: AdminProfile) => {
        setNickTarget(admin);
        setNickInitial(admin.nickname);
        setNickValue(admin.nickname || "");
        setNickError("");
    };

    const saveNickname = async () => {
        if (!nickTarget || nickBusy) return;
        const value = nickValue.trim();
        if (value === (nickInitial ?? "")) { setNickTarget(null); return; }
        setNickBusy(true);
        setNickError("");
        try {
            const headers = await getAuthHeaders();
            if (!headers) throw new Error("Sign in again.");
            const res = await fetch("/api/admin/nicknames", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...headers },
                body: JSON.stringify({ uid: nickTarget.uid, nickname: value }),
            });
            const json = await res.json().catch(() => ({}));
            if (res.status === 409) { setNickError(json.error || "That nickname is taken."); return; }
            if (!res.ok) { setNickError(json.error || `Save failed (${res.status}).`); return; }
            toast.success(value ? `Nickname “${value}” saved.` : "Nickname removed.");
            setNickTarget(null);
            // The admins onSnapshot re-renders with the new field automatically.
        } catch (e: any) {
            setNickError(e?.message || "Save failed.");
        } finally {
            setNickBusy(false);
        }
    };

    const handleCreateAdmin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await createAdminDirectly(createForm.email, createForm.password, createForm.role, profile?.uid, profile?.displayName);
            toast.success("Admin created successfully!");
            setShowCreateModal(false);
            setCreateForm({ email: "", password: "", role: "Activator" }); // Reset
        } catch (err: any) {
            console.error(err);
            toast.error("Failed to create admin: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    // The CTO role is handed over from the Doomsday console, never assigned here.
    const assignableRoles = roles.filter(r => r.id !== CTO_ROLE.id);
    const nameOf = (a: AdminProfile) => a.displayName || a.email;
    const holdersOf = (roleId: string) => admins.filter(a => a.role === roleId && a.status === "active");

    // Document-level Escape handling so the dialogs close even when the folder
    // click left focus somewhere else; matching the app's other dialogs.
    useEffect(() => {
        if (!showCreateModal) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowCreateModal(false); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [showCreateModal]);

    useEffect(() => {
        if (!replacing) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReplacing(null); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [replacing]);

    useEffect(() => {
        setLoading(true);
        // Subscribe to Admins
        const unsubscribeAdmins = subscribeToAllAdmins((data) => {
            setAdmins(data);
            setLoading(false);
        });

        // Subscribe to Pending Registrations
        const unsubscribePending = subscribeToPendingRegistrations((data) => {
            setPendingRegs(data);
        });

        const unsubscribeRoles = subscribeToRoles(setRoles);

        return () => {
            unsubscribeAdmins();
            unsubscribePending();
            unsubscribeRoles();
        };
    }, []);

    // The CTO's first visit stores the default roles so they can be edited.
    useEffect(() => {
        if (profile?.role === "CTO") seedDefaultRoles().catch(err => console.error("Could not store default roles:", err));
    }, [profile?.role]);


    // Returns false when the mail was not sent, so the CTO can notify the person another way.
    const sendNotification = async (to: string, subject: string, text: string) => {
        try {
            const authHeaders = await getAuthHeaders();
            const res = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ to, subject, text })
            });
            return res.ok;
        } catch (err) {
            console.error("Failed to send email", err);
            return false;
        }
    };

    const handleApprove = async (reg: PendingRegistration) => {
        if (!confirm(`Approve ${reg.email}? They will be emailed a login link.`)) return;
        try {
            await approveRegistration(reg.id, profile?.uid, profile?.displayName || "Admin");
            const sent = await sendNotification(
                reg.email,
                "ReLU Admin Access Approved",
                `Congratulations! Your request to join as an admin of the ReLU Club has been approved.\n\nWelcome to the team! Please log in at ${window.location.origin}/admin/login to get started.`
            );
            if (sent) toast.success("User approved!");
            else toast.warning("User approved, but the email could not be sent.");
        } catch (e) {
            console.error(e);
            toast.error("Error approving user");
        }
    };

    const handleReject = async (reg: PendingRegistration) => {
        if (!confirm(`Reject ${reg.email}? They will be emailed about the decision.`)) return;
        try {
            await rejectRegistration(reg.id, profile?.uid, profile?.displayName || "Admin");
            const sent = await sendNotification(
                reg.email,
                "ReLU Admin Access Update",
                "Your request to join as an admin of the ReLU Club has been declined at this time.\n\nIf you believe this is an error, please contact the club Technical Team."
            );
            if (!sent) toast.warning("Request rejected, but the email could not be sent.");
        } catch (e) {
            console.error(e);
            toast.error("Error rejecting user");
        }
    };

    const handleDeleteAdmin = async (uid: string) => {
        if (!confirm("Revoke access for this admin? This action is irreversible.")) return;

        const targetAdmin = admins.find(a => a.uid === uid);
        const targetEmail = targetAdmin?.email || uid;

        try {
            await deleteAdmin(uid);
            const adminName = profile?.displayName || "CTO";
            await logActivity(profile?.uid!, adminName, `Revoked access for admin: ${targetEmail}`);
            toast.success("Access revoked.");
        } catch (e: any) {
            console.error(e);
            toast.error("Failed to revoke access: " + (e?.message || "unknown error"));
        }
    };

    const handleRoleChange = async (target: AdminProfile, newRoleId: string) => {
        const role = roles.find(r => r.id === newRoleId);
        if (!role) return;
        const holders = holdersOf(role.id).filter(a => a.uid !== target.uid);
        if (role.limit !== null && holders.length >= role.limit) {
            setReplacing({ target, role, holders, replacedUid: holders[0].uid });
            return;
        }
        if (!confirm(`Change ${nameOf(target)}'s role to ${role.label}?`)) return;
        try {
            await updateAdminRole(target.uid, role.id, profile?.uid, profile?.displayName || "Admin");
            toast.success("Role updated successfully!");
            setEditingAdmin(null);
        } catch (e: any) {
            console.error(e);
            toast.error("Failed: " + e.message);
        }
    };

    const confirmReplace = async () => {
        if (!replacing) return;
        try {
            await replaceRoleHolder(replacing.target.uid, replacing.replacedUid, replacing.role.id, profile?.uid, profile?.displayName || "Admin");
            toast.success(`${nameOf(replacing.target)} is now ${replacing.role.label}.`);
        } catch (e: any) {
            console.error(e);
            toast.error("Failed: " + e.message);
        } finally {
            setReplacing(null);
        }
    };

    // Helper to calculate tenure end
    const getTenureEnd = (start?: any) => {
        if (!start) return "N/A";
        const date = start.toDate();
        date.setFullYear(date.getFullYear() + 2);
        return date.toLocaleDateString();
    };

    // CTO only. Checked after the hooks so they always run in the same order.
    if (profile?.role !== "CTO") {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-4">
                    <Shield size={32} />
                </div>
                <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
                <p className="text-gray-400 max-w-md">
                    Only the CTO can manage team access and approve new admins.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto text-white">
            <PageHeader
                title="Manage Team Access"
                subtitle="Approve requests, manage roles, nicknames and revoke access."
                icon={<Users size={26} />}
                actions={
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <User size={18} /> Create New Admin
                    </button>
                }
            />

            {/* CREATE MODAL */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="create-admin-title" onKeyDown={e => { if (e.key === "Escape") setShowCreateModal(false); }}>
                    <div className="bg-[#111] border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h2 id="create-admin-title" className="text-xl font-bold mb-4 text-white">Create New Admin</h2>

                        <form onSubmit={handleCreateAdmin} className="space-y-4">
                            <div>
                                <label htmlFor="create-email" className="block text-sm font-bold text-gray-400 mb-1">Email</label>
                                <input
                                    id="create-email"
                                    type="email"
                                    required
                                    autoComplete="off"
                                    autoFocus
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 outline-none"
                                    value={createForm.email}
                                    onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                                />
                            </div>
                            <div>
                                <label htmlFor="create-password" className="block text-sm font-bold text-gray-400 mb-1">Password</label>
                                <input
                                    id="create-password"
                                    type="password"
                                    required
                                    autoComplete="new-password"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 outline-none"
                                    value={createForm.password}
                                    onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                                    placeholder="Strong password"
                                />
                                <PasswordStrengthIndicator password={createForm.password} />
                            </div>
                            <div>
                                <label htmlFor="create-role" className="block text-sm font-bold text-gray-400 mb-1">Role</label>
                                <select
                                    id="create-role"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 outline-none appearance-none cursor-pointer"
                                    value={createForm.role}
                                    onChange={e => setCreateForm({ ...createForm, role: e.target.value })}
                                >
                                    {assignableRoles.map(r => (
                                        <option key={r.id} value={r.id}>{r.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex gap-3 justify-end mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 text-gray-400 hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg disabled:opacity-50"
                                >
                                    {loading ? "Creating..." : "Create Admin"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}


            {/* Pending Requests */}
            <div className="mb-12">
                <h2 className="text-xl font-bold mb-4 text-yellow-500 flex items-center gap-2">
                    <Shield size={20} /> Pending Requests
                </h2>
                <div className="space-y-4">
                    {(() => {
                        // Merge pending_registrations and admins with role="pending"
                        const combinedPending = [...pendingRegs];
                        admins.filter(a => a.role === "pending").forEach(a => {
                            if (!combinedPending.find(p => p.email === a.email || p.id === a.uid)) {
                                combinedPending.push({
                                    id: a.uid,
                                    email: a.email,
                                    requestedAt: a.createdAt
                                });
                            }
                        });

                        if (combinedPending.length === 0) {
                            return <p className="text-gray-500 italic">No pending requests.</p>;
                        }

                        return combinedPending.map(reg => (
                            <div key={reg.id} className="bg-white/5 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between">
                                <div>
                                    <p className="font-bold">{reg.email}</p>
                                    <p className="text-xs text-gray-400">Request Date: {reg.requestedAt?.toDate ? reg.requestedAt.toDate().toLocaleDateString() : new Date(reg.requestedAt?.seconds * 1000).toLocaleDateString()}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleApprove(reg)}
                                        className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg flex items-center gap-2 transition-colors"
                                    >
                                        <Check size={16} /> Approve
                                    </button>
                                    <button
                                        onClick={() => handleReject(reg)}
                                        className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg flex items-center gap-2 transition-colors"
                                    >
                                        <X size={16} /> Reject
                                    </button>
                                </div>
                            </div>
                        ));
                    })()}
                </div>
            </div>

            {/* Active Admins */}
            <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-xl font-bold text-blue-500 flex items-center gap-2">
                        <User size={20} /> Active Team
                    </h2>
                    {/* Search by nickname or email — either identifier finds the admin. */}
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                        <input
                            type="search"
                            aria-label="Search admins by nickname or email"
                            placeholder="Search nickname or email…"
                            value={adminSearchInput}
                            onChange={e => setAdminSearchInput(e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm w-64 md:w-72"
                        />
                    </div>
                </div>

                {/* Role Key */}
                <div className="mb-4 text-xs text-gray-400 flex gap-4">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500"></span> CTO can edit/remove members</span>
                </div>

                <div className="space-y-4">
                    {/* Nickname/email search + canonical role-precedence ordering, shared with Team and About. */}
                    {(() => {
                        const active = sortMembersByRole(admins.filter(u => u.status === "active" || u.status === "onboarding"), roles);
                        const matching = adminSearch
                            ? active.filter(a =>
                                (a.nickname && a.nickname.toLowerCase().includes(adminSearch)) ||
                                normalizeEmail(a.email || "")?.includes(adminSearch) ||
                                (a.displayName || "").toLowerCase().includes(adminSearch) ||
                                a.uid.toLowerCase().includes(adminSearch))
                            : active;
                        if (matching.length === 0) {
                            return <p className="text-gray-500 italic">No admins match “{adminSearch}”.</p>;
                        }
                        return matching.map(admin => (
                        <div key={admin.uid} className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <p className="font-bold">{admin.email}</p>
                                    {admin.nickname && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300 flex items-center gap-1" title="Nickname (display helper; not used for sign-in or permissions)">
                                            <Tag size={10} /> {admin.nickname}
                                        </span>
                                    )}
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${admin.role === 'CTO' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'}`}>
                                        {roleLabel(roles, admin.role)}
                                    </span>
                                    {admin.status === 'onboarding' && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300">Onboarding</span>
                                    )}
                                </div>
                                <div className="flex flex-col sm:flex-row sm:gap-4 text-xs text-gray-400">
                                    <span>UID: {admin.uid.slice(0, 8)}...</span>
                                    {admin.approvedAt && (
                                        <span className="text-orange-400">Tenure Ends: {getTenureEnd(admin.approvedAt)}</span>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 self-end sm:self-auto">

                                {/* CTO Role Editor */}
                                {profile?.role === 'CTO' && profile.uid !== admin.uid && (
                                    <div className="relative group">
                                        <select
                                            className="bg-black/50 border border-white/20 rounded-lg px-2 py-1 text-sm focus:border-blue-500 outline-none appearance-none cursor-pointer pr-8"
                                            value={admin.role}
                                            onChange={(e) => handleRoleChange(admin, e.target.value)}
                                        >
                                            {assignableRoles.map(r => (
                                                <option key={r.id} value={r.id}>{r.label}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">▼</div>
                                    </div>
                                )}

                                {/* Nickname manage + only CTO can delete other admins */}
                                {profile?.role === "CTO" && (
                                    <button
                                        onClick={() => openNicknameEditor(admin)}
                                        className="p-2 text-gray-500 hover:text-pink-400 transition-colors bg-white/5 rounded-lg"
                                        title={admin.nickname ? "Edit nickname" : "Assign nickname"}
                                        aria-label={`${admin.nickname ? "Edit nickname" : "Assign nickname"} for ${admin.email}`}
                                    >
                                        <Pencil size={16} />
                                    </button>
                                )}
                                {profile?.role === "CTO" && profile?.uid !== admin.uid && (
                                    <button
                                        onClick={() => handleDeleteAdmin(admin.uid)}
                                        className="p-2 text-gray-500 hover:text-red-500 transition-colors bg-white/5 rounded-lg"
                                        title="Revoke Access"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                        ));
                    })()}
                    {admins.filter(u => u.status === "active" || u.status === "onboarding").length === 0 && (
                        <p className="text-gray-500">No active admins found.</p>
                    )}
                </div>
            </div>

            <RolesManager
                roles={roles}
                holderCount={id => holdersOf(id).length}
                actorUid={profile?.uid}
                actorName={profile?.displayName || "Admin"}
                canReorder={profile?.role === "CTO"}
            />

            {/* NICKNAME EDITOR (CTO-only; API enforces the same) */}
            {nickTarget && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="nickname-title">
                    <div className="bg-[#111] border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h2 id="nickname-title" className="text-xl font-bold mb-2 flex items-center gap-2"><Tag size={18} className="text-pink-400" /> Nickname</h2>
                        <p className="text-sm text-gray-400 mb-4 break-all">{nickTarget.email}</p>
                        <p className="text-xs text-gray-500 mb-4">Nicknames are searchable display helpers only. Sign-in and permissions always use the real account — never the nickname.</p>
                        {nickError && <p role="alert" className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-sm text-red-300">{nickError}</p>}
                        <input
                            aria-label="Nickname"
                            autoFocus
                            maxLength={80}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 outline-none"
                            value={nickValue}
                            onChange={e => setNickValue(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveNickname(); } }}
                            placeholder="e.g. Rev"
                        />
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => !nickBusy && setNickTarget(null)} className="px-4 py-2 text-gray-400 hover:text-white" disabled={nickBusy}>Cancel</button>
                            <button
                                onClick={saveNickname}
                                disabled={nickBusy}
                                className="px-5 py-2 rounded-lg font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
                            >
                                {nickBusy ? "Saving…" : "Save nickname"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* REPLACE DIALOG */}
            {replacing && (() => {
                const current = replacing.holders.find(h => h.uid === replacing.replacedUid)!;
                return (
                    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="replace-title">
                        <div className="bg-[#111] border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl">
                            <h2 id="replace-title" className="text-xl font-bold mb-4">Replace {replacing.role.label}?</h2>
                            {replacing.holders.length > 1 && (
                                <label className="block mb-4 text-sm text-gray-400">
                                    All {replacing.role.limit} {replacing.role.label} seats are taken. Who should step down?
                                    <select
                                        className="mt-2 w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 outline-none"
                                        value={replacing.replacedUid}
                                        onChange={e => setReplacing({ ...replacing, replacedUid: e.target.value })}
                                    >
                                        {replacing.holders.map(h => <option key={h.uid} value={h.uid}>{nameOf(h)}</option>)}
                                    </select>
                                </label>
                            )}
                            <p className="text-gray-300">
                                Do you want to replace the current {replacing.role.label}, <strong>{nameOf(current)}</strong>, with <strong>{nameOf(replacing.target)}</strong>?
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                                {nameOf(current)} will become {roleLabel(roles, DEFAULT_ROLE_ID)}. You can change that afterwards.
                            </p>
                            <div className="flex gap-3 justify-end mt-6">
                                <button onClick={() => setReplacing(null)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
                                <button onClick={confirmReplace} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold">Replace</button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
