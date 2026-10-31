"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { updateAdminProfileData } from "@/lib/api";
import { uploadMedia } from "@/lib/mediaUpload";
import { useToast } from "@/components/ui/Toast";

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
        socials: {
            linkedin: "",
            instagram: "",
            github: ""
        }
    });
    const [imageFile, setImageFile] = useState<File | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setLoading(true);

        try {
            let photoURL = profile?.photoURL || "";
            if (imageFile) {
                photoURL = (await uploadMedia(imageFile, "team_profiles", (p) => setProgress(p))).url;
            }

            await updateAdminProfileData(user.uid, {
                ...formData,
                photoURL,
                status: "active" // Graduate from onboarding
            });

            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/admin"; // Full reload to refresh auth state/guard
        } catch (error) {
            console.error("Onboarding failed:", error);
            toast.error("Failed to save profile. Please try again.");
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="onboarding-name" className="block text-sm font-bold text-gray-400 mb-2">Full Name</label>
                            <input
                                id="onboarding-name"
                                required
                                type="text"
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3"
                                value={formData.displayName}
                                onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                            />
                        </div>
                        <div>
                            <label htmlFor="onboarding-rollno" className="block text-sm font-bold text-gray-400 mb-2">Roll Number</label>
                            <input
                                id="onboarding-rollno"
                                required
                                type="text"
                                placeholder="e.g., AIE23000"
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3"
                                value={formData.rollNo}
                                onChange={e => setFormData({ ...formData, rollNo: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="onboarding-dob" className="block text-sm font-bold text-gray-400 mb-2">Date of Birth</label>
                            <input
                                id="onboarding-dob"
                                required
                                type="date"
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white"
                                value={formData.dob}
                                onChange={e => setFormData({ ...formData, dob: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-400 mb-2">Club Role</label>
                            {/* Roles are assigned by the CTO from Manage Admins. */}
                            <p className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-gray-300">
                                {profile?.role?.replace("_", " ")}
                            </p>
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
