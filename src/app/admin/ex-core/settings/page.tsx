"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { subscribeToRoles } from "@/lib/api";
import { getAuthHeaders } from "@/lib/authHeaders";
import { ClubRole, withBuiltIns, EX_CORE_ROLE } from "@/lib/roles";
import type { ExCoreMember } from "@/lib/excore";
import { latestRoleLabel, tenureLabel } from "@/lib/excore";
import RoleHistoryEditor, {
    RoleHistoryRow, defaultRoleHistoryRow, roleHistoryToRows, rowsToRoleHistory,
} from "@/components/admin/RoleHistoryEditor";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import {
    History, Loader2, Save, UserRound, Linkedin, Github, Instagram, ArrowLeft,
} from "lucide-react";

/**
 * The Ex-Core member's OWN settings page. This is the only management surface
 * an Ex-Core hand-off account can reach besides /admin/profile: it holds zero
 * admin authority, so the sidebar and guard keep every admin page away from it.
 *
 * The page edits the profile linked to the signed-in account:
 * - member category (Core / Activator),
 * - role history (which roles, in which academic years),
 * - the public name, bio and links.
 *
 * Ownership is established server-side from the verified token; the client
 * never sends a member id. Ordering stays CTO-managed.
 */

const EMPTY_SOCIALS = { linkedin: "", github: "", instagram: "" };

export default function ExCoreSettingsPage() {
    const { profile } = useAuth();
    const { toast } = useToast();
    const [member, setMember] = useState<ExCoreMember | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    const [name, setName] = useState("");
    const [memberType, setMemberType] = useState<"core" | "activator">("core");
    const [history, setHistory] = useState<RoleHistoryRow[]>([defaultRoleHistoryRow()]);
    const [bio, setBio] = useState("");
    const [socials, setSocials] = useState({ ...EMPTY_SOCIALS });
    const [saving, setSaving] = useState(false);

    const [roles, setRoles] = useState<ClubRole[]>(withBuiltIns([]));

    const roleOptions = useMemo(
        () => roles.map(r => r.label).sort((a, b) => a.localeCompare(b)),
        [roles],
    );

    useEffect(() => subscribeToRoles(setRoles), []);

    // Load the profile linked to this account. A 404/member:null means "not
    // created yet" — the page then becomes the create form.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const headers = await getAuthHeaders();
                if (!headers) throw new Error("Sign in again.");
                const res = await fetch("/api/ex-core/self", { headers });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(json.error || `Could not load your Ex-Core profile (${res.status}).`);
                if (cancelled) return;
                const m = (json.member ?? null) as ExCoreMember | null;
                setMember(m);
                if (m) {
                    setName(m.name || "");
                    setMemberType(m.memberType === "activator" ? "activator" : "core");
                    const rows = roleHistoryToRows(m.roleHistory);
                    setHistory(rows.length ? rows : [defaultRoleHistoryRow()]);
                    setBio(m.bio ?? "");
                    setSocials({
                        linkedin: m.socials?.linkedin ?? "",
                        github: m.socials?.github ?? "",
                        instagram: m.socials?.instagram ?? "",
                    });
                } else {
                    setName(profile?.displayName || "");
                }
            } catch (err) {
                if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load your Ex-Core profile.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // profile is only used to prefill a brand-new profile.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auth can resolve after the profile fetch above. Prefill the create form
    // from the account profile once it arrives — but only fields the member has
    // not typed into yet, so nothing they entered is overwritten.
    useEffect(() => {
        if (loading || member || !profile) return;
        setName(current => (current.trim() ? current : profile.displayName || ""));
        setSocials(current =>
            current.linkedin || current.github || current.instagram
                ? current
                : {
                    linkedin: profile.socials?.linkedin ?? "",
                    github: profile.socials?.github ?? "",
                    instagram: profile.socials?.instagram ?? "",
                },
        );
    }, [loading, member, profile]);

    const handleSave = async () => {
        if (!name.trim()) {
            toast("A name is required.", "error");
            return;
        }
        const roleHistory = rowsToRoleHistory(history);
        if (!roleHistory) {
            toast("Add at least one tenure: a role with its start and end year.", "error");
            return;
        }

        setSaving(true);
        try {
            const headers = await getAuthHeaders();
            if (!headers) throw new Error("Sign in again.");
            const payload = {
                name: name.trim(),
                memberType,
                roleHistory,
                bio,
                socials,
            };
            const res = await fetch("/api/ex-core/self", {
                method: member ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json", ...headers },
                body: JSON.stringify(payload),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || `Save failed (${res.status}).`);

            if (!member && json.id) {
                // Re-load so the page switches into edit mode with the stored record.
                const refreshed = await fetch("/api/ex-core/self", { headers });
                const refreshedJson = await refreshed.json().catch(() => ({}));
                if (refreshed.ok && refreshedJson.member) {
                    setMember(refreshedJson.member as ExCoreMember);
                }
            }
            toast(member ? "Your Ex-Core settings were saved." : "Your Ex-Core profile was created.", "success");
        } catch (err) {
            toast(err instanceof Error ? err.message : "Could not save your Ex-Core settings.", "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="pb-12 max-w-3xl">
            <PageHeader
                title="Ex-Core Settings"
                subtitle="Your own Ex-Core profile: the category you belong to, the roles you held and the years you served. Changes appear on the public Ex-Core page."
                icon={<History size={26} />}
            />

            <div className="flex flex-wrap items-center gap-3 mb-6">
                <Link
                    href="/admin/profile"
                    className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-white/20 transition-colors"
                >
                    <ArrowLeft size={14} /> My Profile
                </Link>
                <p className="text-xs text-gray-500">
                    Ordering on the public page is managed by the CTO. You control everything about your own entry.
                </p>
            </div>

            {loading ? (
                <div className="py-16 flex justify-center">
                    <Loader2 className="animate-spin text-blue-400" size={28} aria-hidden="true" />
                </div>
            ) : loadError ? (
                <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl p-6">
                    <p className="font-semibold">Could not load your Ex-Core settings</p>
                    <p className="text-sm mt-1">{loadError}</p>
                </div>
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
                    {!member && (
                        <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-4">
                            <p className="text-sm text-blue-200 font-semibold">Your Ex-Core profile is not created yet.</p>
                            <p className="text-xs text-blue-200/70 mt-1">
                                Fill this in once: your category, the roles you held and your links. It will appear on the public Ex-Core page.
                            </p>
                        </div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Name on the public page</span>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                maxLength={120}
                                className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                placeholder="Your full name"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Member category</span>
                            <select
                                value={memberType}
                                onChange={e => setMemberType(e.target.value as "core" | "activator")}
                                className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                <option value="core">Core member</option>
                                <option value="activator">Activator</option>
                            </select>
                            <span className="text-[11px] text-gray-500 mt-1 block">
                                Core members appear as full profile cards; Activators as the compact list.
                            </span>
                        </label>
                    </div>

                    <RoleHistoryEditor
                        rows={history}
                        onChange={setHistory}
                        roleOptions={roleOptions}
                        required
                        title="Roles you held"
                    />

                    <label className="block">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Bio (public)</span>
                        <textarea
                            rows={3}
                            value={bio}
                            onChange={e => setBio(e.target.value)}
                            maxLength={2000}
                            className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            placeholder="A short note about your time on the team"
                        />
                    </label>

                    <div className="grid sm:grid-cols-3 gap-3">
                        <label className="block">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Linkedin size={11} /> LinkedIn</span>
                            <input
                                type="url"
                                placeholder="https://linkedin.com/in/…"
                                value={socials.linkedin}
                                onChange={e => setSocials(s => ({ ...s, linkedin: e.target.value }))}
                                className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Github size={11} /> GitHub</span>
                            <input
                                type="url"
                                placeholder="https://github.com/…"
                                value={socials.github}
                                onChange={e => setSocials(s => ({ ...s, github: e.target.value }))}
                                className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Instagram size={11} /> Instagram</span>
                            <input
                                type="url"
                                placeholder="https://instagram.com/…"
                                value={socials.instagram}
                                onChange={e => setSocials(s => ({ ...s, instagram: e.target.value }))}
                                className="mt-1.5 w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                        </label>
                    </div>

                    {member && (
                        <div className="text-xs text-gray-500 border-t border-white/10 pt-4">
                            <span className="text-gray-400 font-semibold">Currently listed as:</span>{" "}
                            {memberType === "activator" ? "Activator" : "Core"} · {latestRoleLabel(member, memberType)}
                            {roleHistoryToRows(member.roleHistory).length > 0 && (
                                <> · {roleHistoryToRows(member.roleHistory)
                                    .map(r => `${tenureLabel(r.start, r.end)} ${r.role}`)
                                    .join(", ")}</>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold transition-colors"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {member ? "Save settings" : "Create my Ex-Core profile"}
                        </button>
                        <p className="text-[11px] text-gray-600">
                            Photo and account details come from <Link href="/admin/profile" className="text-blue-400 hover:text-blue-300">My Profile</Link>.
                        </p>
                    </div>

                    {profile?.role === EX_CORE_ROLE.id && (
                        <p className="text-[11px] text-gray-600 flex items-center gap-1.5">
                            <UserRound size={12} aria-hidden="true" />
                            Ex-Core accounts have no admin access — this page and My Profile are all you need.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
