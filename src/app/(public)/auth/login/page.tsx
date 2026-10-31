"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getUserProfile } from "@/lib/api";
import Link from "next/link";
import { Mail, Lock, ArrowRight, AlertTriangle, KeyRound, CheckCircle, ShieldAlert, Timer, X } from "lucide-react";
import { useLoginRateLimit } from "@/hooks/useLoginRateLimit";

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetEmail, setResetEmail] = useState("");
    const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
    const [resetError, setResetError] = useState("");
    const rateLimit = useLoginRateLimit("public");

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        if (rateLimit.isLockedOut) {
            setError(`Too many failed attempts. Try again in ${rateLimit.formattedTime}.`);
            setLoading(false);
            return;
        }

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 1. Check if user is an ADMIN
            // We need to dynamically import getAdminProfile to avoid circular deps if any, or just use the one from api
            const { getAdminProfile } = await import("@/lib/api");
            const adminProfile = await getAdminProfile(user.uid);

            if (adminProfile) {
                // Admin found - Redirect to Admin Dashboard immediately (bypass email verification)
                router.push("/admin");
                return;
            }

            // 2. Not an Admin - Public User Flow
            if (!user.emailVerified) {
                router.push("/auth/verify-email");
                return;
            }

            // Check if profile exists and is complete
            router.push("/profile");
            rateLimit.resetAttempts();

        } catch (err: any) {
            console.error(err);
            if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
                rateLimit.recordFailedAttempt();
                setError("Invalid email or password.");
            } else if (err.code === "auth/too-many-requests") {
                setError("Too many attempts. Please try again later.");
            } else {
                setError("Failed to login. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setResetStatus("sending");
        setResetError("");

        try {
            await sendPasswordResetEmail(auth, resetEmail);
            setResetStatus("sent");
        } catch (err: any) {
            console.error("Password reset error:", err);
            if (err.code === "auth/user-not-found") {
                setResetError("No account found with this email.");
            } else if (err.code === "auth/invalid-email") {
                setResetError("Please enter a valid email address.");
            } else {
                setResetError("Failed to send reset email. Please try again.");
            }
            setResetStatus("error");
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center pt-24 pb-12 px-4">
            <div className="w-full max-w-md bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500"></div>

                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Welcome Back</h1>
                    <p className="text-gray-400 mt-2 text-sm">Login to access your profile</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-2">
                        <label htmlFor="login-email" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Email</label>
                        <div className="relative group">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={18} />
                            <input
                                id="login-email"
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all font-mono text-sm"
                                placeholder="u4.....@av.students.amrita.edu"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label htmlFor="login-password" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Password</label>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowResetModal(true);
                                    setResetEmail(email);
                                    setResetStatus("idle");
                                    setResetError("");
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                            >
                                Forgot Password?
                            </button>
                        </div>
                        <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={18} />
                            <input
                                id="login-password"
                                type="password"
                                autoComplete="current-password"
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all font-mono text-sm"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    {error && (
                        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-3">
                            <AlertTriangle className="text-red-500 shrink-0" size={18} />
                            <p className="text-red-400 text-xs font-bold">{error}</p>
                        </div>
                    )}

                    {rateLimit.isLockedOut && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-3">
                            <Timer className="text-red-500 shrink-0 mt-0.5" size={18} />
                            <div>
                                <p className="text-red-400 text-xs font-bold">Account temporarily locked</p>
                                <p className="text-red-400/70 text-[11px] mt-1">Too many failed attempts. Try again in {rateLimit.formattedTime}.</p>
                            </div>
                        </div>
                    )}

                    {rateLimit.showWarning && (
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-start gap-3">
                            <ShieldAlert className="text-yellow-500 shrink-0 mt-0.5" size={18} />
                            <p className="text-yellow-400 text-xs font-bold">
                                {rateLimit.attemptsRemaining} attempt{rateLimit.attemptsRemaining !== 1 ? "s" : ""} remaining before temporary lockout.
                            </p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || rateLimit.isLockedOut}
                        className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-500/20 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? "Logging In..." : <>Login <ArrowRight size={18} /></>}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <p className="text-gray-400 text-sm">
                        Don&apos;t have an account?{" "}
                        <Link href="/auth/signup" className="text-blue-400 hover:text-blue-300 font-bold transition-colors">
                            Sign up here
                        </Link>
                    </p>
                </div>
            </div>

            {/* Password Reset Modal */}
            {showResetModal && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="reset-title"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowResetModal(false); }}
                    onKeyDown={(e) => { if (e.key === "Escape") setShowResetModal(false); }}
                >
                    <div className="w-full max-w-sm bg-[#0a0a0a] border border-white/10 rounded-2xl p-6 relative">
                        <button
                            onClick={() => setShowResetModal(false)}
                            aria-label="Close password reset"
                            className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={18} aria-hidden="true" />
                        </button>

                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                <KeyRound className="text-blue-400" size={20} />
                            </div>
                            <h2 id="reset-title" className="text-lg font-bold">Reset Password</h2>
                        </div>

                        {resetStatus === "sent" ? (
                            <div className="text-center py-4">
                                <CheckCircle className="text-green-400 mx-auto mb-3" size={40} />
                                <p className="text-green-400 font-bold mb-2">Email Sent!</p>
                                <p className="text-gray-400 text-sm">
                                    Check your inbox at <span className="text-white font-mono text-xs">{resetEmail}</span> for a password reset link.
                                </p>
                                <button
                                    onClick={() => setShowResetModal(false)}
                                    className="mt-4 px-6 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10 transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handlePasswordReset}>
                                <p className="text-gray-400 text-sm mb-4">
                                    Enter your email address and we&apos;ll send you a link to reset your password.
                                </p>
                                <div className="relative group mb-3">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={18} />
                                    <input
                                        type="email"
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all font-mono text-sm"
                                        placeholder="your@email.com"
                                        required
                                    />
                                </div>

                                {resetError && (
                                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-3 mb-3">
                                        <AlertTriangle className="text-red-500 shrink-0" size={16} />
                                        <p className="text-red-400 text-xs font-bold">{resetError}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={resetStatus === "sending"}
                                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-3 rounded-xl shadow-lg transition-all disabled:opacity-50"
                                >
                                    {resetStatus === "sending" ? "Sending..." : "Send Reset Link"}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
