"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import { checkinForEvent } from "@/lib/api";

interface CheckInModalProps {
    eventId: string;
    onClose: () => void;
    onSuccess: () => void;
}

export default function CheckInModal({ eventId, onClose, onSuccess }: CheckInModalProps) {
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    // Escape and backdrop close; focus the code input immediately.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !loading) onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        inputRef.current?.focus();
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose, loading]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            await checkinForEvent(eventId, code);
            onSuccess();
            onClose();
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Check-in failed. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Self check-in"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
        >
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-sm p-6 relative">
                <button onClick={onClose} aria-label="Close check-in" className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20} /></button>

                <h2 className="text-xl font-bold mb-4">Self Check-in</h2>
                <p className="text-gray-400 text-sm mb-6">Enter the 4-digit code displayed by the organizer.</p>

                <form onSubmit={handleSubmit}>
                    <input
                        ref={inputRef}
                        type="text"
                        maxLength={4}
                        value={code}
                        aria-label="4-digit check-in code"
                        aria-invalid={!!error}
                        onChange={(e) => {
                            setCode(e.target.value);
                            setError("");
                        }}
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-4 text-center text-3xl tracking-[0.5em] font-mono mb-2 focus:border-blue-500 outline-none uppercase text-white"
                        placeholder="0000"
                    />
                    {error && <p className="text-red-400 text-sm text-center mb-4">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading || code.length !== 4}
                        className="w-full py-3 rounded-lg bg-green-600 hover:bg-green-500 font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : "Verify & Check In"}
                    </button>
                </form>
            </div>
        </div>
    );
}
