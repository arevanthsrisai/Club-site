"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth";
import { useLoginRateLimit } from "@/hooks/useLoginRateLimit";
import { ShieldAlert, Timer } from "lucide-react";

export default function AdminLoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const rateLimit = useLoginRateLimit("admin");

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        if (rateLimit.isLockedOut) {
            setError(`Too many failed attempts. Try again in ${rateLimit.formattedTime}.`);
            setLoading(false);
            return;
        }

        try {
            await signIn(email, password);
            rateLimit.resetAttempts();
            router.push("/admin");
        } catch (err: any) {
            console.error(err);
            if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found") {
                rateLimit.recordFailedAttempt();
                setError("Invalid email or password.");
            } else if (err.code === "auth/too-many-requests") {
                setError("Too many attempts. Try again later.");
            } else {
                setError("Failed to login. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-black">
            <div className="bg-white/5 border border-white/10 p-8 rounded-xl w-full max-w-md backdrop-blur-sm">
                <h1 className="text-3xl font-bold text-center text-white mb-8">Admin Login</h1>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label htmlFor="admin-login-email" className="block text-sm font-bold text-gray-400 mb-2">Email</label>
                        <input
                            id="admin-login-email"
                            type="email"
                            required
                            autoFocus
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>

                    <div>
                        <label htmlFor="admin-login-password" className="block text-sm font-bold text-gray-400 mb-2">Password</label>
                        <input
                            id="admin-login-password"
                            type="password"
                            required
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>

                    {error && <p role="alert" className="text-red-400 text-sm text-center bg-red-500/10 py-2 rounded">{error}</p>}

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
                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all disabled:opacity-50 flex items-center justify-center"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            "Enter Dashboard"
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center text-sm text-gray-400">
                    <p>New administrator? <a href="/admin/signup" className="text-blue-400 hover:text-blue-300 hover:underline transition-colors">Request access here</a></p>
                </div>
            </div>
        </div>
    );
}
