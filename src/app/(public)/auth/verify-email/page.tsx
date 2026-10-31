"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { sendEmailVerification, reload } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Mail, RefreshCw, CheckCircle, ArrowRight } from "lucide-react";

export default function VerifyEmailPage() {


    const router = useRouter();
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState<string | null>(null);

    useEffect(() => {
        const checkVerification = async () => {
            if (auth.currentUser) {
                setEmail(auth.currentUser.email);
                await auth.currentUser.reload();
                if (auth.currentUser.emailVerified) {
                    router.push("/");
                }
            }
        };
        checkVerification();
    }, [router]);

    const handleResend = async () => {
        if (!auth.currentUser) return;
        setLoading(true);
        setMessage("");
        try {
            await sendEmailVerification(auth.currentUser);
            setMessage("Verification email sent! Check your inbox (and spam).");
        } catch (error: any) {
            console.error(error);
            if (error.code === 'auth/too-many-requests') {
                setMessage("Please wait a moment before trying again.");
            } else {
                setMessage("Failed to send email. Try again later.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleIClickedIt = async () => {
        if (!auth.currentUser) return;
        setLoading(true);
        try {
            await auth.currentUser.reload(); // Refresh auth state
            if (auth.currentUser.emailVerified) {
                router.push("/profile?onboarding=true"); // Redirect to profile to finish setup
            } else {
                setMessage("Email not verified yet. Please click the link in your email and try again.");
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center pt-24 pb-12 px-4">
            <div className="w-full max-w-md bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl relative overflow-hidden text-center">
                <div className="mx-auto w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <Mail size={40} className="text-blue-400" />
                </div>

                <h1 className="text-2xl font-bold text-white mb-2">Verify your Email</h1>
                <p className="text-gray-400 mb-6">
                    We&apos;ve sent a verification link to <span className="text-white font-bold">{email}</span>.
                </p>
                <p className="text-sm text-gray-500 mb-4">Didn&apos;t receive it?</p>

                <div className="space-y-4">
                    <button
                        onClick={handleIClickedIt}
                        disabled={loading}
                        className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-green-500/20 transition-all flex items-center justify-center gap-2"
                    >
                        <CheckCircle size={18} /> I&apos;ve Verified It
                    </button>

                    <button
                        onClick={handleResend}
                        disabled={loading}
                        className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Resend Email
                    </button>
                </div>

                {message && (
                    <p role="status" className={`mt-6 text-sm p-3 rounded-lg ${message.includes("sent") ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {message}
                    </p>
                )}
            </div>
        </div>
    );
}
