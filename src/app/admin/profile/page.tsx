
"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth, signOut } from "@/lib/auth";
import { updateAdminProfileData, logActivity, deleteFileByUrl } from "@/lib/api";
import { uploadMedia } from "@/lib/mediaUpload";
import { getAuthHeaders } from "@/lib/authHeaders";
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { useRouter } from "next/navigation";
import { LogOut, Save, Camera, User, Clock, ShieldCheck, Lock, Github, Linkedin, Instagram, Calendar, FileText, UserCircle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { auth } from "@/lib/firebase"; // Direct auth import needed for re-auth if not fully exposed in lib/auth
import Image from "next/image";

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

export default function AdminProfilePage() {
    const { user, profile } = useAuth();
    const router = useRouter();

    // Profile State
    const [name, setName] = useState("");
    const [photo, setPhoto] = useState<string | null>(null);
    const [rollNo, setRollNo] = useState("");
    const [dob, setDob] = useState("");

    // Socials State
    const [linkedin, setLinkedin] = useState("");
    const [github, setGithub] = useState("");
    const [instagram, setInstagram] = useState("");

    const [loading, setLoading] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState("");

    // Password State
    const [currentPass, setCurrentPass] = useState("");
    const [newPass, setNewPass] = useState("");
    const [confirmPass, setConfirmPass] = useState("");
    const [passLoading, setPassLoading] = useState(false);
    const [passMessage, setPassMessage] = useState("");
    const dobInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (profile) {
            setName(profile.displayName || "");
            setPhoto(profile.photoURL || null);
            setRollNo(profile.rollNo || "");
            setDob(profile.dob || "");
            setLinkedin(profile.socials?.linkedin || "");
            setGithub(profile.socials?.github || "");
            setInstagram(profile.socials?.instagram || "");
        }
    }, [profile]);

    // Calculate Tenure
    const calculateTenure = () => {
        if (!profile?.approvedAt) return { progress: 0, daysLeft: 1095, label: "Not yet active" };

        const approvalDate = profile.approvedAt.toDate();
        const now = new Date();
        const tenureDurationMs = 2 * 365 * 24 * 60 * 60 * 1000;
        const elapsed = now.getTime() - approvalDate.getTime();

        // Capped at 100%
        const progress = Math.min((elapsed / tenureDurationMs) * 100, 100);
        const timeLeftMs = Math.max(tenureDurationMs - elapsed, 0);
        const daysLeft = Math.ceil(timeLeftMs / (24 * 60 * 60 * 1000));

        return { progress, daysLeft, label: `${daysLeft} Days Remaining` };
    };

    const tenure = calculateTenure();

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setLoading(true);
        setMessage("");
        setProgress(0);

        if (!ROLLNO_REGEX.test(rollNo)) {
            setMessage("Roll number must be 3–20 alphanumeric characters.");
            return;
        }

        try {
            let newPhotoURL = photo;
            if (imageFile) {
                // Upload new image to B2 through the secured server route
                newPhotoURL = (await uploadMedia(imageFile, "profiles", (p) => setProgress(p))).url;

                // Delete old image if it exists and is different from the new one (and not null)
                if (photo && photo !== newPhotoURL) {
                    await deleteFileByUrl(photo);
                    // Legacy Firebase URLs still clear via Firestore-only cleanup above;
                    // B2 objects for the previous photo are removed server-side:
                    await fetch("/api/admin/delete-b2", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                        body: JSON.stringify({ url: photo }),
                    }).catch(() => undefined);
                }
            }

            await updateAdminProfileData(user.uid, {
                displayName: name,
                photoURL: newPhotoURL || null,
                rollNo,
                dob,
                socials: {
                    linkedin,
                    github,
                    instagram
                }
            });

            await logActivity(user.uid, name, "Updated their profile");

            // If the user is in Ex-Core, sync their profile to ex_core_members
            if (profile?.exCoreAt) {
                try {
                    const res = await fetch("/api/ex-core/self", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
                        body: JSON.stringify({ name, photoURL: newPhotoURL || photo, bio: "", socials: { linkedin, github, instagram} }),
                    });
                    if (!res.ok) { console.warn("Failed to sync Ex-Core profile update:", await res.text()); }
                } catch (e) {
                    console.warn("Failed to sync Ex-Core profile:", e);
                }
            }

            setMessage("Profile updated successfully!");
        } catch (error) {
            console.error("Error updating profile:", error);
            setMessage("Failed to update profile.");
        } finally {
            setLoading(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !user.email) return;

        if (newPass !== confirmPass) {
            setPassMessage("New passwords do not match.");
            return;
        }

        if (newPass.length < 8) {
            setPassMessage("Password must be at least 8 characters.");
            return;
        }

        setPassLoading(true);
        setPassMessage("");

        try {
            const credential = EmailAuthProvider.credential(user.email, currentPass);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPass);

            await logActivity(user.uid, profile?.displayName || user.email!, "Changed their password");

            setPassMessage("Password changed successfully!");
            setCurrentPass("");
            setNewPass("");
            setConfirmPass("");
        } catch (error: any) {
            console.error("Error changing password:", error);
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
                setPassMessage("Incorrect current password.");
            } else {
                setPassMessage("Failed to change password. Please try again.");
            }
        } finally {
            setPassLoading(false);
        }
    };

    const handleLogout = async () => {
        await signOut();
        router.push("/admin/login");
    };

    return (
        <div className="max-w-6xl mx-auto text-white p-4">
            <PageHeader
                title="My Profile"
                subtitle="Your personal details, socials and account security."
                icon={<UserCircle size={26} />}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Tenure & Info */}
                <div className="lg:col-span-1 space-y-6">
                    {/* Profile Card */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
                        <div className="relative w-32 h-32 mx-auto mb-4 group">


                            <div className="relative w-full h-full rounded-full overflow-hidden border-4 border-blue-500/30 bg-gray-800">
                                {photo || imageFile ? (
                                    <Image
                                        src={imageFile ? URL.createObjectURL(imageFile) : photo!}
                                        alt="Profile"
                                        fill
                                        sizes="128px"
                                        className="object-cover"
                                    />
                                ) : (
                                    <User className="w-full h-full p-6 text-gray-500" />
                                )}
                            </div>
                            <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-full">
                                <Camera className="text-white" />
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => e.target.files && setImageFile(e.target.files[0])}
                                />
                            </label>
                        </div>
                        <h2 className="text-xl font-bold">{name || "Admin User"}</h2>
                        <p className="text-blue-400 text-sm mb-4">{user?.email}</p>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${profile?.role === 'CTO' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'}`}>
                            {profile?.role?.toUpperCase().replace("_", " ")}
                        </span>
                    </div>

                    {/* Tenure Card */}
                    {profile?.role !== 'pending' && profile?.role !== 'CTO' && ( // Hide for CTO as they are permanent
                        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <Clock size={20} className="text-yellow-500" /> Tenure Status
                            </h3>
                            <div className="mb-2 flex justify-between text-sm">
                                <span className="text-gray-400">Term Progress</span>
                                <span className="text-white font-mono">{tenure.progress.toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden mb-4">
                                <div
                                    className={`h-full ${tenure.daysLeft < 30 ? 'bg-red-500' : 'bg-green-500'}`}
                                    style={{ width: `${tenure.progress}%` }}
                                ></div>
                            </div>
                            <p className="text-center font-bold text-lg">{tenure.label}</p>
                            <p className="text-xs text-center text-gray-400 mt-2">
                                Access expires in 2 years from approval.
                            </p>
                        </div>
                    )}

                    {profile?.role === 'CTO' && (
                        <div className="bg-white/5 border border-purple-500/30 rounded-xl p-6 text-center">
                            <ShieldCheck size={40} className="text-purple-500 mx-auto mb-4" />
                            <h3 className="font-bold text-lg mb-2">CTO Access</h3>
                            <p className="text-sm text-gray-400">You have permanent access to the platform.</p>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors"
                    >
                        <LogOut size={18} /> Sign Out
                    </button>
                </div>

                {/* Right Column: Edit Form & Security */}
                <div className="lg:col-span-2 space-y-8">

                    {/* General Info */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-8">
                        <h3 className="text-xl font-bold mb-6 border-b border-white/10 pb-4 flex items-center gap-2">
                            <User size={20} className="text-blue-500" /> General Information
                        </h3>

                        <form onSubmit={handleSave} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 mb-2">Display Name</label>
                                    <input
                                        type="text"
                                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Full Name"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 mb-2">Roll Number / ID</label>
                                    <div className="relative">
                                        <FileText size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                        <input
                                            type="text"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 pl-10 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            value={rollNo}
                                            onChange={(e) => setRollNo(e.target.value)}
                                            placeholder="AV.SC.U4CSE26001"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 mb-2">Date of Birth</label>
                                    <div className="relative w-full">
                                        <button
                                            type="button"
                                            onClick={() => dobInputRef.current?.showPicker()}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 pl-10 text-left flex items-center gap-3 hover:bg-black/60 transition-colors"
                                        >
                                            <Calendar size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                            <span className={dob ? 'text-white' : 'text-gray-500'}>
                                                {formatDob(dob) || 'Pick a date'}
                                            </span>
                                        </button>
                                        <input
                                            ref={dobInputRef}
                                            type="date"
                                            className="sr-only"
                                            value={dob}
                                            onChange={(e) => setDob(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <h4 className="font-bold text-gray-300 pt-4 border-t border-white/5">Social Links</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">LinkedIn</label>
                                    <div className="relative">
                                        <Linkedin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500" />
                                        <input
                                            type="url"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 pl-9 text-sm text-white focus:border-blue-500 focus:outline-none"
                                            value={linkedin}
                                            onChange={(e) => setLinkedin(e.target.value)}
                                            placeholder="https://linkedin.com/in/..."
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">GitHub</label>
                                    <div className="relative">
                                        <Github size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="url"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 pl-9 text-sm text-white focus:border-blue-500 focus:outline-none"
                                            value={github}
                                            onChange={(e) => setGithub(e.target.value)}
                                            placeholder="https://github.com/..."
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Instagram</label>
                                    <div className="relative">
                                        <Instagram size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pink-500" />
                                        <input
                                            type="url"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 pl-9 text-sm text-white focus:border-blue-500 focus:outline-none"
                                            value={instagram}
                                            onChange={(e) => setInstagram(e.target.value)}
                                            placeholder="https://instagram.com/..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 flex items-center justify-end">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    {loading ? (
                                        <div className="flex items-center gap-2">
                                            {progress > 0 && progress < 100 ? (
                                                <div className="w-24 h-2 bg-white/20 rounded-full overflow-hidden">
                                                    <div className="h-full bg-white transition-all duration-200" style={{ width: `${progress}%` }} />
                                                </div>
                                            ) : (
                                                "Saving..."
                                            )}
                                        </div>
                                    ) : <><Save size={18} /> Save Details</>}
                                </button>
                            </div>

                            {message && (
                                <p className={`text-center p-3 rounded-lg ${message.includes("success") ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                                    {message}
                                </p>
                            )}
                        </form>
                    </div>

                    {/* Security - Password Change */}
                    <div className="bg-white/5 border border-red-500/10 rounded-xl p-8">
                        <h3 className="text-xl font-bold mb-6 border-b border-white/10 pb-4 flex items-center gap-2">
                            <Lock size={20} className="text-red-500" /> Security
                        </h3>

                        <form onSubmit={handleChangePassword} className="space-y-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2">Current Password</label>
                                <input
                                    type="password"
                                    required
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                                    value={currentPass}
                                    onChange={(e) => setCurrentPass(e.target.value)}
                                    placeholder="Enter current password to verify"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 mb-2">New Password</label>
                                    <input
                                        type="password"
                                        required
                                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                                        value={newPass}
                                        onChange={(e) => setNewPass(e.target.value)}
                                        placeholder="Min 8 characters"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 mb-2">Confirm New Password</label>
                                    <input
                                        type="password"
                                        required
                                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                                        value={confirmPass}
                                        onChange={(e) => setConfirmPass(e.target.value)}
                                        placeholder="Retype new password"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex items-center justify-end">
                                <button
                                    type="submit"
                                    disabled={passLoading}
                                    className="px-6 py-3 bg-red-600 hover:bg-red-500 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    {passLoading ? "Updating..." : <><ShieldCheck size={18} /> Update Password</>}
                                </button>
                            </div>

                            {passMessage && (
                                <p className={`text-center p-3 rounded-lg ${passMessage.includes("success") ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                                    {passMessage}
                                </p>
                            )}
                        </form>
                    </div>

                </div>
            </div>
        </div>
    );
}
