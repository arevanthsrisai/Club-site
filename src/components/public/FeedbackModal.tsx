"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, Star } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { submitFeedback } from "@/lib/api";
import { Feedback } from "@/types";

interface FeedbackModalProps {
    eventId: string;
    onClose: () => void;
    onSuccess: () => void;
}

const MATRIX_QUESTIONS = [
    { key: "content", label: "Content" },
    { key: "activities", label: "Activities" },
    { key: "interaction", label: "Interaction" },
    { key: "organization", label: "Organization/Management" },
    { key: "enjoyment", label: "Enjoyment" },
    { key: "knowledgeable", label: "Knowledgeable" },
];

export default function FeedbackModal({ eventId, onClose, onSuccess }: FeedbackModalProps) {
    const [overallRating, setOverallRating] = useState(0);
    const [matrixRatings, setMatrixRatings] = useState<Record<string, number>>({});
    const [opinion, setOpinion] = useState("");
    const [loading, setLoading] = useState(false);
    const closeRef = useRef<HTMLButtonElement>(null);
    const toast = useToast();

    // Escape and backdrop close; focus lands on the close button like
    // the avatar and check-in dialogs.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !loading) onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        closeRef.current?.focus();
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose, loading]);

    const handleMatrixChange = (key: string, value: number) => {
        setMatrixRatings(prev => ({ ...prev, [key]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await submitFeedback({
                eventId,
                overallRating,
                matrixRatings: matrixRatings as Feedback["matrixRatings"],
                opinion,
            });
            onSuccess();
            onClose();
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Failed to submit feedback.");
        } finally {
            setLoading(false);
        }
    };

    const isFormValid = overallRating > 0 &&
        Object.keys(matrixRatings).length === MATRIX_QUESTIONS.length &&
        opinion.trim().length > 0;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Event feedback"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
        >
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative shadow-2xl">
                <button onClick={onClose} aria-label="Close feedback form" ref={closeRef} className="absolute top-4 right-4 text-gray-400 hover:text-white z-10"><X size={20} /></button>

                <div className="p-8 pt-16">
                    <h2 className="text-2xl font-bold mb-2">Event Feedback</h2>
                    <p className="text-gray-400 text-sm mb-8">Please take a moment to rate your experience.</p>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        {/* Overall Rating */}
                        <div>
                            <label className="block text-sm font-bold text-gray-300 mb-3">Overall Rating</label>
                            <div className="flex gap-2">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <button
                                        key={star}
                                        type="button"
                                        onClick={() => setOverallRating(star)}
                                        aria-label={`Rate ${star} out of 5`}
                                        aria-pressed={overallRating >= star}
                                        className={`p-2 rounded-full transition-all ${overallRating >= star ? 'text-yellow-400 scale-110' : 'text-gray-600 hover:text-gray-400'}`}
                                    >
                                        <Star size={32} fill={overallRating >= star ? "currentColor" : "none"} />
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Matrix Grid */}
                        <div>
                            <label className="block text-sm font-bold text-gray-300 mb-4">How would you rate the following aspects?</label>
                            <div className="space-y-4">
                                <div className="grid grid-cols-6 gap-2 text-xs text-gray-500 text-center font-bold uppercase mb-2">
                                    <div className="text-left col-span-1"></div>
                                    <div>Poor</div>
                                    <div>Fair</div>
                                    <div>Ok</div>
                                    <div>Good</div>
                                    <div>Excellent</div>
                                </div>
                                {MATRIX_QUESTIONS.map((q) => (
                                    <div key={q.key} className="grid grid-cols-6 gap-2 items-center py-2 border-b border-white/5">
                                        <div className="col-span-1 text-sm text-gray-300 font-medium">{q.label}</div>
                                        {[1, 2, 3, 4, 5].map((val) => (
                                            <div key={val} className="flex justify-center">
                                                <input
                                                    type="radio"
                                                    name={q.key}
                                                    value={val}
                                                    checked={matrixRatings[q.key] === val}
                                                    onChange={() => handleMatrixChange(q.key, val)}
                                                    aria-label={`${q.label}: ${val} of 5`}
                                                    className="w-5 h-5 accent-blue-500 cursor-pointer"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Opinion */}
                        <div>
                            <label className="block text-sm font-bold text-gray-300 mb-2">Your opinion on today&apos;s event</label>
                            <textarea
                                value={opinion}
                                onChange={(e) => setOpinion(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl p-4 min-h-[100px] text-white focus:border-blue-500 outline-none"
                                placeholder="Share your thoughts..."
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !isFormValid}
                            className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold disabled:opacity-50 flex items-center justify-center gap-2 text-lg"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : "Submit Feedback"}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
