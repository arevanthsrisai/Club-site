"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { updateAdminProfileData } from "@/lib/api";
import { getAuthHeaders } from "@/lib/authHeaders";
import { EX_CORE_ROLE, DEFAULT_ROLE_ID } from "@/lib/roles";
import { parseDateString } from "@/lib/birthdays";
import { uploadMedia } from "@/lib/mediaUpload";
import { useToast } from "@/components/ui/Toast";
import { CalendarDays } from "lucide-react";

/**
 * Roll number format for admins: AV.<2 letters>.U4<3 letters><5 digits>
 * Example: AV.SC.U4CSE26001
 * Admins may use any email so they type their roll number manually.
 */
const ROLLNO_REGEX = /^AV\.[A-Z]{2}\.U4[A-Z]{3}[0-9]{5}$/;

/** Convert YYYY-MM-DD → DD-MM-YYYY for display (input value stays YYYY-MM-DD). */
function formatDob(date: string | null): string {
    if (!date) return '';
    const parts = date.split('-');
    if (parts.length !== 3) return date;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/**
 * Onboarding. Club role is a self-service choice between the two
 * non-privileged roles (Activator / Ex-Core); anything above them stays
 * CTO-assigned from Manage Admins. The role change goes through
 * /api/admin/onboarding/role, which authorizes the caller server-side —
 * Firestore rules never hand out `role` writes to the owner.
 */

export default function OnboardingPage() {
    const { user, profile } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const toast = useToast();
    const [progress, setProgress] = useState(0);

    const [formData, setFormData] = useState({
        displayName: "",
        rollNo: "",
        dob: "",
        clubRole: "",
        socials: {
            linkedin: "",
            instagram: "",
            github: ""
        }
    });
    const [imageFile, setImageFile] = useState<File | null>(null);
    const dobInputRef = useRef<HTMLInputElement>(null);

    // Self-service roles: Activator (the default team role) and Ex-Core Member.
    // A still-pending account can only onboard as Ex-Core; Activator access
    // needs CTO approval, which is exactly what flips role away from "pending".
    const isPending = profile?.role === "pending";
    const canChooseRole = isPending
        || profile?.role === DEFAULT_ROLE_ID
        || profile?.role === EX_CORE_ROLE.id;
    const DEFAULT_SELF_ROLE = isPending ? EX_CORE_ROLE.id : DEFAULT_ROLE_ID;

    // Seed the selector to the user's current role once the profile loads,
    // without clobbering a choice they already made.
    useEffect(() => {
        if (!canChooseRole) return;
        setFormData(prev => prev.clubRole ? prev : { ...prev, clubRole: DEFAULT_SELF_ROLE });
    }, [canChooseRole, DEFAULT_SELF_ROLE]);

    /** Inclusive-day "YYYY-MM-DD" for today, built from calendar parts (never UTC). */
    function todayLocalISO(): string {
        const now = new Date();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        return `${now.getFullYear()}-${mm}-${dd}`;
    }

    function validateDob(value: string): string | null {
        const parts = parseDateString(value);
        if (!parts) return "Pick a valid date of birth.";
        if (value > todayLocalISO()) return "Date of birth cannot be in the future.";
        if (parts.year < new Date().getFullYear() - 120) return "Check the birth year — it looks too far in the past.";
        return null;
    }

    /** Server-authorized club-role change; only the two unprivileged roles are accepted. */
    async function assignSelfRole(targetRole: string) {
        if (targetRole === profile?.role) return; // already there; nothing to save
        const headers = await getAuthHeaders();
        if (!headers) throw new Error("Sign in again.");
        const res = await fetch("/api/admin/onboarding/role", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ clubRole: targetRole }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(json.error || `Could not save the club role (${res.status}).`);
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        const dobError = formData.dob ? validateDob(formData.dob) : null;
        if (dobError) {
            toast.error(dobError);
            return;
        }

        if (!ROLLNO_REGEX.test(formData.rollNo)) {
            toast.error("Roll number must be 3–20 alphanumeric characters.");
            return;
        }

        setLoading(true);

        try {
            // The role change must happen while the account is still in
            // onboarding — finish it before the profile self-update flips the
            // status to active, after which only the CTO assigns roles.
            if (canChooseRole && formData.clubRole) {
                await assignSelfRole(formData.clubRole);
            }

            let photoURL = profile?.photoURL || "";
            if (imageFile) {
                photoURL = (await uploadMedia(imageFile, "team_profiles", (p) => setProgress(p))).url;
            }

            await updateAdminProfileData(user.uid, {
                displayName: formData.displayName,
                rollNo: formData.rollNo,
                dob: formData.dob, // stored as-is: "YYYY-MM-DD"
                socials: formData.socials,
                photoURL,
                status: "active" // Graduate from onboarding
            });

            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/admin"; // Full reload to refresh auth state/guard
        } catch (error) {
            console.error("Onboarding failed:", error);
            toast.error(error instanceof Error ? error.message : "Failed to save profile. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white/5 border border-white/10 rounded-2xl p-8">
                <h1 className="text-3xl font-bold mb-2">Welcome to the team</h1>
                <p className="text-gray-400 mb-8">Please complete your profile to access the dashboard.</p>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 gap-6">
                        <div>
                            <label htmlFor="onboarding-name" className="block text-sm font-bold text-gray-400 mb-2">Full Name</label>
                            <input
                                id="onboarding-name"
                                required
                                type="text"
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3"
                                value={formData.displayName}
                                onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                                placeholder="Full Name"
                            />
                        </div>
                        <div>
                            <label htmlFor="onboarding-rollno" className="block text-sm font-bold text-gray-400 mb-2">Roll Number</label>
                            <input
                                id="onboarding-rollno"
                                required
                                type="text"
                                placeholder="AV.SC.U4CSE26001"
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3"
                                value={formData.rollNo}
                                onChange={e => setFormData({ ...formData, rollNo: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="onboarding-dob" className="block text-sm font-bold text-gray-400 mb-2">Date of Birth</label>
                            <div className="relative w-full">
                                <button
                                    type="button"
                                    onClick={() => dobInputRef.current?.showPicker()}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 pl-10 text-left flex items-center hover:bg-black/60 transition-colors"
                                >
                                    <CalendarDays size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                    <span className={formData.dob ? 'text-white' : 'text-gray-500'}>
                                        {formatDob(formData.dob) || 'Pick a date'}
                                    </span>
                                </button>
                                <input
                                    ref={dobInputRef}
                                    type="date"
                                    className="sr-only"
                                    value={formData.dob}
                                    onChange={e => setFormData({ ...formData, dob: e.target.value })}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Optional — used for birthday wishes. Your birth year stays private.</p>
                        </div>
                        <div>
                            <label htmlFor="onboarding-role" className="block text-sm font-bold text-gray-400 mb-2">Club Role</label>
                            {canChooseRole ? (
                                <>
                                    <select
                                        id="onboarding-role"
                                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white"
                                        value={formData.clubRole}
                                        onChange={e => setFormData({ ...formData, clubRole: e.target.value })}
                                    >
                                        <option value={DEFAULT_ROLE_ID} disabled={isPending}>
                                            Activator{isPending ? " (needs admin approval)" : ""}
                                        </option>
                                        <option value={EX_CORE_ROLE.id}>Ex-Core</option>
                                    </select>
                                    {isPending && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            Team (Activator) access still needs admin approval. Choosing Ex-Core finishes your
                                            signup now; the CTO can later move your account to the active team.
                                        </p>
                                    )}
                                </>
                            ) : (
                                /* Roles above the two self-service ones stay CTO-assigned. */
                                <p className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-gray-300">
                                    {profile?.role?.replace("_", " ")}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Profile Pic */}
                    <div>                            <label htmlFor="onboarding-photo" className="block text-sm font-bold text-gray-400 mb-2">Profile Photo</label>
                            <input
                                id="onboarding-photo"
                                type="file"
                                accept="image/*"
                            onChange={e => setImageFile(e.target.files?.[0] || null)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3"
                        />
                        <p className="text-xs text-gray-500 mt-1">Required for the Team Page.</p>
                    </div>

                    {/* Socials */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 pb-2">Social Links</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <input
                                type="url"
                                placeholder="LinkedIn URL"
                                className="bg-black/40 border border-white/10 rounded-lg p-3"
                                value={formData.socials.linkedin}
                                onChange={e => setFormData({ ...formData, socials: { ...formData.socials, linkedin: e.target.value } })}
                            />
                            <input
                                type="url"
                                placeholder="Instagram URL"
                                className="bg-black/40 border border-white/10 rounded-lg p-3"
                                value={formData.socials.instagram}
                                onChange={e => setFormData({ ...formData, socials: { ...formData.socials, instagram: e.target.value } })}
                            />
                            <input
                                type="url"
                                placeholder="GitHub URL"
                                className="bg-black/40 border border-white/10 rounded-lg p-3"
                                value={formData.socials.github}
                                onChange={e => setFormData({ ...formData, socials: { ...formData.socials, github: e.target.value } })}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-lg transition-all disabled:opacity-50 relative overflow-hidden"
                    >
                        {loading && (
                            <div className="absolute inset-0 bg-blue-700/50">
                                <div className="h-full bg-blue-500 transition-all duration-300 origin-left" style={{ width: `${progress}%` }}></div>
                            </div>
                        )}
                        <span className="relative z-10">{loading ? `Setting up details... ${Math.round(progress)}%` : "Complete Setup"}</span>
                    </button>
                </form>
            </div>
        </div>
    );
}
