"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth";
import { createUserProfile } from "@/lib/api";
import Link from "next/link";
import { Mail, Lock, ArrowRight, AlertTriangle } from "lucide-react";

/**
 * Extract the roll number from a student's college email.
 *
 * Email local part format: av.sc.u4cse26001
 * Roll number format: AV.SC.U4CSE26001
 */
function extractRollNo(email: string): string | null {
    const local = email.split("@")[0];
    const parts = local.split(".");
    if (parts.length !== 3) return null;
    return parts.map(p => p.toUpperCase()).join(".");
}
import { sendEmailVerification, User } from "firebase/auth";
import { isPasswordStrong } from "@/lib/schemas";
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator";

export default function SignupPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(false);

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        // Normalize: trim + lowercase so "U4...@AV.Students..." still passes validation
        const normalizedEmail = email.trim().toLowerCase();
        setEmail(normalizedEmail);

        if (!normalizedEmail.endsWith("@av.students.amrita.edu")) {
            setError("Only @av.students.amrita.edu emails are allowed.");
            setLoading(false);
            return;
        }

        if (!isPasswordStrong(password)) {
            setError("Password does not meet the security requirements.");
            setLoading(false);
            return;
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            setLoading(false);
            return;
        }

        try {
            // Race-safe duplicate guard: check our own collections before Auth
            // state is mutated. Auth's email-already-in-use is a backstop.
            const { assertEmailNotInUse } = await import("@/services/emails");
            await assertEmailNotInUse(normalizedEmail);

            // Students get a 'users' profile; signUp() in lib/auth is for the admin flow.
            const { createUserWithEmailAndPassword, getAuth } = await import("firebase/auth");
            const { auth } = await import("@/lib/firebase");

            const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
            const user = userCredential.user;

            // Send Verification Email
            await sendEmailVerification(user);

            // Create User Profile (Not Admin Profile)
            // Auto-extract roll number from college email: av.sc.u4cse26001 → AV.SC.U4CSE26001
            const rollNo = extractRollNo(normalizedEmail);
            await createUserProfile(user.uid, normalizedEmail, rollNo ?? undefined);

            router.push("/auth/verify-email");
        } catch (err: any) {
            console.error(err);
            if (err.code === "auth/email-already-in-use" || err.message === "Email is already registered.") {
                setError("Email is already registered.");
            } else if (err.code === "auth/weak-password") {
                setError("Password should be at least 6 characters.");
            } else {
                setError("Failed to create account. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center pt-24 pb-12 px-4">
            <div className="w-full max-w-md bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
                {/* Background Glow */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-orange-500"></div>

                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Join the Family</h1>
                    <p className="text-gray-400 mt-2 text-sm">Create your account to access events</p>
                </div>

                <form onSubmit={handleSignup} className="space-y-6">
                    {/* Email Input */}
                    <div className="space-y-2">
                        <label htmlFor="signup-email" className="text-xs font-bold text-gray-500 uppercase tracking-wider">College Email</label>
                        <div className="relative group">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-red-500 transition-colors" size={18} />
                            <input
                                id="signup-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-600 focus:outline-none focus:border-red-500/50 focus:bg-white/10 transition-all font-mono text-sm"
                                placeholder="u4...@av.students.amrita.edu"
                                required
                            />
                        </div>
                        <p className="text-[10px] text-gray-500">* Only @av.students.amrita.edu allowed</p>
                    </div>

                    {/* Password Input */}
                    <div className="space-y-2">
                        <label htmlFor="signup-password" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Password</label>
                        <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-red-500 transition-colors" size={18} />
                            <input
                                id="signup-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-600 focus:outline-none focus:border-red-500/50 focus:bg-white/10 transition-all font-mono text-sm"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                        <PasswordStrengthIndicator password={password} />
                    </div>

                    {/* Confirm Password Input */}
                    <div className="space-y-2">
                        <label htmlFor="signup-confirm" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Confirm Password</label>
                        <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-red-500 transition-colors" size={18} />
                            <input
                                id="signup-confirm"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-600 focus:outline-none focus:border-red-500/50 focus:bg-white/10 transition-all font-mono text-sm"
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

                    {/* Terms & Privacy Agreement */}
                    <label className="flex items-start gap-3 cursor-pointer group flex-wrap">
                        <input
                            type="checkbox"
                            checked={agreedToTerms}
                            onChange={(e) => setAgreedToTerms(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/5 text-red-500 focus:ring-red-500/50 focus:ring-offset-0 cursor-pointer accent-red-500"
                        />
                        <span className="text-xs text-gray-400 leading-relaxed">
                            I have read and agree to the{" "}
                            <Link href="/terms" className="text-red-400 hover:text-red-300 underline underline-offset-2 transition-colors" target="_blank">
                                Terms &amp; Conditions
                            </Link>{" "}
                            and{" "}
                            <Link href="/privacy" className="text-red-400 hover:text-red-300 underline underline-offset-2 transition-colors" target="_blank">
                                Privacy Policy
                            </Link>.
                        </span>
                    </label>

                    <button
                        type="submit"
                        disabled={loading || !agreedToTerms}
                        className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-red-500/20 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? "Creating Account..." : <>Sign Up <ArrowRight size={18} /></>}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <p className="text-gray-400 text-sm">
                        Already verified?{" "}
                        <Link href="/auth/login" className="text-red-400 hover:text-red-300 font-bold transition-colors">
                            Login here
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
