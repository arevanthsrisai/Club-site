"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useAuth, signOut } from "@/lib/auth";
import { getUserProfile, updateUserProfile, getOnboardingConfig, OnboardingConfig } from "@/lib/api";
import { Timestamp } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
    User, LogOut, Edit2, AlertCircle, Briefcase, Hash, Layers,
    CheckCircle, Camera, BadgeCheck, ShieldAlert, Phone, CalendarDays, RefreshCw
} from "lucide-react";
import { UserProfile } from "@/types";
import AvatarSelector from "@/components/ui/AvatarSelector";
import { useToast } from "@/components/ui/Toast";
import PageLoading from "@/components/ui/PageLoading";

const EMPTY_FORM = {
    displayName: "",
    rollNo: "",
    class: "",
    section: "",
    mobile: "",
    hosteller: false
};

function formFromProfile(p: UserProfile | null) {
    return {
        displayName: p?.displayName || "",
        rollNo: p?.rollNo || "",
        class: p?.class || "",
        section: p?.section || "",
        mobile: p?.mobile || "",
        hosteller: p?.hosteller || false
    };
}

function ProfileContent() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const toast = useToast();

    // "onboarding" mode via query param or missing critical fields
    const [isEditing, setIsEditing] = useState(false);
    const [showAvatarSelector, setShowAvatarSelector] = useState(false);

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);

    const [formData, setFormData] = useState(EMPTY_FORM);
    const [config, setConfig] = useState<OnboardingConfig>({ classes: [], sections: [] });
    const [error, setError] = useState("");

    const loadData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setLoadError(false);
        try {
            const [userProfile, onboardingConfig] = await Promise.all([
                getUserProfile(user.uid),
                getOnboardingConfig()
            ]);

            setConfig(onboardingConfig);
            setProfile(userProfile);
            setFormData(formFromProfile(userProfile));

            if (userProfile) {
                // If critical fields are missing, force edit mode
                if (!userProfile.rollNo || !userProfile.class) {
                    setIsEditing(true);
                }
            } else {
                // No profile yet? Should have been created at signup, but just in case
                setIsEditing(true);
            }

            // Force edit if query param is present
            if (searchParams.get("onboarding") === "true") {
                setIsEditing(true);
            }
        } catch (e) {
            console.error("Failed to load profile", e);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [user, searchParams]);

    // Initial Load + signed-out / unverified redirects
    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                // Clear stale profile data on logout
                setProfile(null);
                setFormData(EMPTY_FORM);
                router.push("/auth/login");
                return;
            }
            if (!user.emailVerified) {
                router.push("/auth/verify-email");
                return;
            }
            loadData();
        }
    }, [user, authLoading, router, loadData]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        // Basic Validation
        if (!formData.displayName || !formData.rollNo || !formData.class || !formData.section || !formData.mobile) {
            setError("Please fill in all fields.");
            return;
        }
        if (!/^\d{10}$/.test(formData.mobile.replace(/\s/g, ""))) {
            setError("Enter a valid 10-digit mobile number.");
            return;
        }

        setSaving(true);
        try {
            if (!user) return;

            await updateUserProfile(user.uid, {
                ...formData,
                mobile: formData.mobile.replace(/\s/g, ""),
                email: user.email || "", // Ensure email is saved
                // If RollNo, Class, or Section changed, revoke verification
                isVerified: (
                    profile?.rollNo === formData.rollNo &&
                    profile?.class === formData.class &&
                    profile?.section === formData.section
                ),
                // If new profile, set creation time
                ...(profile ? {} : { createdAt: Timestamp.now() })
            });

            // Reload data to reflect changes
            await loadData();
            setIsEditing(false);
            toast.success("Profile saved successfully.");
        } catch (e) {
            console.error(e);
            setError("Failed to save profile.");
        } finally {
            setSaving(false);
        }
    };

    // Cancel restores the saved profile so unsaved edits never leak into the next edit session.
    const handleCancel = () => {
        setFormData(formFromProfile(profile));
        setError("");
        setIsEditing(false);
    };

    const handleAvatarSelect = async (url: string) => {
        // Optimistic update
        if (profile && user) {
            setProfile({ ...profile, photoURL: url });
            // Save immediately
            try {
                await updateUserProfile(user.uid, { photoURL: url });
                toast.success("Avatar updated.");
            } catch (e) {
                console.error("Failed to update avatar", e);
                toast.error("Could not update avatar.");
            }
        }
    };

    if (loading || authLoading) {
        return (
            <div className="min-h-screen pt-32 md:pt-36 pb-12 px-4 max-w-4xl mx-auto" aria-busy="true">
                {/* Skeleton mirrors the final layout so the content shift on load is a swap, not a jump. */}
                <div className="flex justify-between items-center mb-8">
                    <div className="h-8 w-44 rounded-lg bg-white/10 animate-pulse" />
                    <div className="h-10 w-32 rounded-lg bg-white/5 animate-pulse" />
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                    <div className="flex flex-col md:flex-row gap-8">
                        <div className="flex-shrink-0 mx-auto md:mx-0 text-center md:text-left">
                            <div className="w-32 h-32 rounded-full bg-white/10 animate-pulse mb-4 mx-auto md:mx-0" />
                            <div className="h-6 w-40 rounded bg-white/10 animate-pulse mb-2 mx-auto md:mx-0" />
                            <div className="h-4 w-24 rounded bg-white/10 animate-pulse mx-auto md:mx-0" />
                        </div>
                        <div className="flex-grow grid grid-cols-1 sm:grid-cols-2 gap-6 w-full">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="bg-black/20 p-4 rounded-xl border border-white/5">
                                    <div className="h-3 w-16 rounded bg-white/10 animate-pulse mb-2" />
                                    <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <span className="sr-only" role="status">Loading your profile…</span>
            </div>
        );
    }

    if (loadError && !profile) {
        return (
            <div className="min-h-[60vh] pt-32 md:pt-36 pb-12 px-4 max-w-4xl mx-auto flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-6">
                    <ShieldAlert size={32} />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Couldn&apos;t load your profile</h1>
                <p className="text-gray-400 max-w-md mb-8">
                    Something went wrong while fetching your details. This is usually temporary — try again.
                </p>
                <button
                    onClick={() => loadData()}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors"
                >
                    <RefreshCw size={16} /> Retry
                </button>
            </div>
        );
    }

    const joinedDate = (() => {
        try {
            const d = (profile?.createdAt as { toDate?: () => Date } | null)?.toDate?.();
            return d ? d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;
        } catch {
            return null;
        }
    })();

    const verifiedChip = (
        <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${profile?.isVerified
                ? "bg-green-500/10 text-green-400 border-green-500/30"
                : "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"}`}
        >
            {profile?.isVerified ? <BadgeCheck size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}
            {profile?.isVerified ? "Details verified" : "Pending review"}
        </span>
    );

    return (
        <div className="min-h-screen pt-32 md:pt-36 pb-12 px-4 max-w-4xl mx-auto">

            {showAvatarSelector && (
                <AvatarSelector
                    currentAvatar={profile?.photoURL}
                    onSelect={handleAvatarSelect}
                    onClose={() => setShowAvatarSelector(false)}
                />
            )}

            {/* Page header */}
            <div className="flex justify-between items-center mb-8 gap-4">
                <h1 className="text-3xl font-bold text-white">Your Profile</h1>
                <button
                    onClick={() => signOut().then(() => router.push("/"))}
                    className="flex items-center gap-2 text-red-500 hover:text-red-400 font-bold transition-colors bg-white/5 hover:bg-red-500/10 px-4 py-2 rounded-lg border border-red-500/20"
                >
                    <LogOut size={18} aria-hidden="true" /> Sign Out
                </button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl relative overflow-hidden shadow-xl shadow-black/20">
                {/* Decorative background */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" aria-hidden="true"></div>

                {isEditing ? (
                    /* EDIT FORM */
                    <form onSubmit={handleSave} className="space-y-6 relative z-10 p-6 md:p-8" aria-label="Profile details">
                        <h2 className="text-xl font-bold text-gray-200 flex items-center gap-2">
                            {profile?.rollNo ? <Edit2 size={20} className="text-blue-400" aria-hidden="true" /> : <CheckCircle size={20} className="text-green-400" aria-hidden="true" />}
                            {profile?.rollNo ? "Edit Details" : "Complete your Profile"}
                        </h2>

                        {/* Personal Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="profile-name" className="block text-xs font-bold text-gray-400 uppercase mb-2">Full Name</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
                                    <input
                                        id="profile-name"
                                        type="text"
                                        autoComplete="name"
                                        maxLength={60}
                                        value={formData.displayName}
                                        onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                        placeholder="John Doe"
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="profile-rollno" className="block text-xs font-bold text-gray-400 uppercase mb-2">Roll Number</label>
                                <div className="relative">
                                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
                                    <input
                                        id="profile-rollno"
                                        type="text"
                                        maxLength={15}
                                        value={formData.rollNo}
                                        onChange={e => setFormData({ ...formData, rollNo: e.target.value.toUpperCase() })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 uppercase"
                                        placeholder="U4AIE..."
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Academic Info */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label htmlFor="profile-class" className="block text-xs font-bold text-gray-400 uppercase mb-2">Class / Branch</label>
                                <div className="relative">
                                    <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={18} aria-hidden="true" />
                                    <select
                                        id="profile-class"
                                        value={formData.class}
                                        onChange={e => setFormData({ ...formData, class: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 appearance-none cursor-pointer"
                                    >
                                        <option value="">Select Branch</option>
                                        {config.classes.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="profile-section" className="block text-xs font-bold text-gray-400 uppercase mb-2">Section</label>
                                <div className="relative">
                                    <Layers className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={18} aria-hidden="true" />
                                    <select
                                        id="profile-section"
                                        value={formData.section}
                                        onChange={e => setFormData({ ...formData, section: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 appearance-none cursor-pointer"
                                    >
                                        <option value="">Select Section</option>
                                        {config.sections.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="profile-mobile" className="block text-xs font-bold text-gray-400 uppercase mb-2">Mobile Number</label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
                                    <input
                                        id="profile-mobile"
                                        type="tel"
                                        inputMode="numeric"
                                        maxLength={10}
                                        value={formData.mobile}
                                        onChange={e => setFormData({ ...formData, mobile: e.target.value.replace(/\D/g, "") })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                        placeholder="9876543210"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Residence */}
                        <fieldset className="flex flex-col md:flex-row md:items-center gap-4 bg-black/20 p-4 rounded-xl border border-white/5">
                            <legend className="text-xs font-bold text-gray-400 uppercase mb-2 md:mb-0 md:mr-4 px-0">Residence Type</legend>
                            <div className="flex items-center gap-6">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio"
                                        name="residence"
                                        checked={formData.hosteller}
                                        onChange={() => setFormData({ ...formData, hosteller: true })}
                                        className="peer sr-only"
                                    />
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${formData.hosteller ? "border-blue-500 bg-blue-500/20" : "border-gray-500 group-hover:border-gray-400"}`} aria-hidden="true">
                                        {formData.hosteller && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                                    </div>
                                    <span className={`text-sm transition-colors ${formData.hosteller ? "text-white" : "text-gray-400 group-hover:text-gray-300"}`}>Hosteller</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio"
                                        name="residence"
                                        checked={!formData.hosteller}
                                        onChange={() => setFormData({ ...formData, hosteller: false })}
                                        className="peer sr-only"
                                    />
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${!formData.hosteller ? "border-blue-500 bg-blue-500/20" : "border-gray-500 group-hover:border-gray-400"}`} aria-hidden="true">
                                        {!formData.hosteller && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                                    </div>
                                    <span className={`text-sm transition-colors ${!formData.hosteller ? "text-white" : "text-gray-400 group-hover:text-gray-300"}`}>Day Scholar</span>
                                </label>
                            </div>
                        </fieldset>

                        {error && (
                            <div role="alert" className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-500/20">
                                <AlertCircle size={16} aria-hidden="true" /> {error}
                            </div>
                        )}

                        <div className="flex justify-end gap-4 pt-4 border-t border-white/10">
                            {profile?.rollNo && ( // Only show cancel if they already had a profile
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="px-6 py-2.5 text-gray-400 hover:text-white transition-colors rounded-lg"
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                type="submit"
                                disabled={saving}
                                className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-400"
                            >
                                {saving ? (
                                    <>
                                        <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> Saving…
                                    </>
                                ) : (
                                    "Save Profile"
                                )}
                            </button>
                        </div>
                    </form>
                ) : (
                    /* VIEW MODE */
                    <div className="relative z-10 p-6 md:p-8">
                        <div className="flex flex-col md:flex-row gap-8">
                            {/* Avatar / Identity */}
                            <div className="flex-shrink-0 mx-auto md:mx-0 text-center md:text-left">
                                <div className="relative group w-fit mx-auto">
                                    <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white/10 shadow-2xl">
                                        {profile?.photoURL ? (
                                            <Image
                                                src={profile.photoURL || ""}
                                                alt={profile.displayName ? `${profile.displayName}'s profile picture` : "Profile picture"}
                                                width={128}
                                                height={128}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-4xl font-bold text-white">
                                                {profile?.displayName?.charAt(0) || user?.email?.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                    </div>

                                    {/* Avatar change — keyboard reachable overlay plus a visible button below */}
                                    <button
                                        type="button"
                                        onClick={() => setShowAvatarSelector(true)}
                                        className="absolute inset-0 rounded-full bg-black/60 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-focus-within:ring-2 group-focus-within:ring-blue-400 transition-opacity cursor-pointer"
                                    >
                                        <Camera className="text-white" size={26} aria-hidden="true" />
                                        <span className="text-[10px] uppercase font-bold tracking-wider text-white">Change</span>
                                        <span className="sr-only">Change profile picture</span>
                                    </button>
                                </div>

                                <div className="mt-4">
                                    <h2 className="text-2xl font-bold text-white break-words">{profile?.displayName || user?.email?.split("@")[0]}</h2>
                                    {profile?.rollNo && <p className="text-blue-400 font-mono text-sm mt-1">{profile.rollNo}</p>}
                                    <div className="flex flex-wrap justify-center md:justify-start gap-2 mt-3">
                                        <span className="px-3 py-1 bg-white/10 rounded-full text-xs text-gray-300 border border-white/10">
                                            {profile?.hosteller ? "Hosteller" : "Day Scholar"}
                                        </span>
                                        {verifiedChip}
                                    </div>
                                    {joinedDate && (
                                        <p className="flex items-center justify-center md:justify-start gap-1.5 text-xs text-gray-500 mt-3">
                                            <CalendarDays size={12} aria-hidden="true" /> Member since {joinedDate}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Details Grid */}
                            <div className="flex-grow grid grid-cols-1 sm:grid-cols-2 gap-4 w-full content-start">
                                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Email</p>
                                    <p className="text-gray-300 font-mono text-sm break-all">{user?.email}</p>
                                    <p className="flex items-center gap-1 text-xs text-green-400 mt-1.5">
                                        <BadgeCheck size={12} aria-hidden="true" /> Verified
                                    </p>
                                </div>

                                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Class</p>
                                    <p className="text-white font-bold">{profile?.class} — {profile?.section}</p>
                                </div>

                                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Mobile</p>
                                    <p className="text-gray-300 font-mono">{profile?.mobile || "—"}</p>
                                </div>

                                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Status</p>
                                    <p className={`font-bold text-sm flex items-center gap-2 ${profile?.isVerified ? "text-green-400" : "text-yellow-400"}`}>
                                        {profile?.isVerified
                                            ? <><CheckCircle size={14} aria-hidden="true" /> Verified member</>
                                            : <><ShieldAlert size={14} aria-hidden="true" /> Awaiting review</>}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-8 flex justify-end border-t border-white/10 pt-6">
                            <button
                                onClick={() => setIsEditing(true)}
                                className="flex items-center gap-2 px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors font-semibold focus-visible:ring-2 focus-visible:ring-blue-400"
                            >
                                <Edit2 size={16} aria-hidden="true" /> Edit Profile
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function ProfilePage() {
    return (
        <Suspense fallback={<PageLoading />}>
            <ProfileContent />
        </Suspense>
    );
}
