"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth";
import {
    getEvent,
    Event,
    Feedback,
    getEventFeedbacks,
} from "@/lib/api";
import { exportEventWorkflow, EXPORT_FORMATS, type ExportFormatId } from "@/services/eventWorkflows";
import {
    ArrowLeft, Download, Users, User, MessageSquare, Search, X, Loader2,
} from "lucide-react";
import { workflowState } from "@/lib/workflow";

export default function EventFeedbackPage() {
    const params = useParams<{ id: string }>();
    const [event, setEvent] = useState<Event | null>(null);
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const toast = useToast();

    // Export modal state
    const [exportModal, setExportModal] = useState<{
        format: ExportFormatId;
        busy: boolean;
    } | null>(null);

    useEffect(() => {
        async function fetchData() {
            if (params.id) {
                const [eventData, fbsData] = await Promise.all([
                    getEvent(params.id),
                    getEventFeedbacks(params.id),
                ]);
                setEvent(eventData);
                setFeedbacks(fbsData);
            }
            setLoading(false);
        }
        fetchData();
    }, [params.id]);

    const state = useMemo(() => workflowState(event as any, "feedback"), [event]);

    const filteredFeedbacks = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return feedbacks.filter(fb =>
            fb.userName.toLowerCase().includes(q) ||
            fb.opinion.toLowerCase().includes(q)
        );
    }, [feedbacks, searchTerm]);

    const avgRating = useMemo(() => {
        if (feedbacks.length === 0) return 0;
        const sum = feedbacks.reduce((acc, fb) => acc + fb.overallRating, 0);
        return (sum / feedbacks.length).toFixed(1);
    }, [feedbacks]);

    const confirmExport = useCallback(async () => {
        if (!exportModal || !event) return;
        setExportModal(prev => prev ? { ...prev, busy: true } : null);
        try {
            await exportEventWorkflow(event.id, "feedback", exportModal.format, searchTerm);
            toast.success(`Feedback data exported as ${exportModal.format.toUpperCase()}.`);
            setExportModal(null);
        } catch (err: any) {
            toast.error(err?.message || "Export failed.");
            setExportModal(prev => prev ? { ...prev, busy: false } : null);
        }
    }, [exportModal, event, toast, searchTerm]);

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!event) {
        return <div className="text-center text-red-500 mt-10">Event not found</div>;
    }

    return (
        <div className="max-w-7xl mx-auto pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <div className="flex items-center gap-4 mb-2">
                        <Link href="/admin/events" className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors">
                            <ArrowLeft size={18} />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold">{event.title}</h1>
                            <p className="text-gray-400 text-sm">
                                {new Date(event.date).toLocaleDateString()} • Feedback
                                {event.isFeedbackOpen && <span className="ml-2 bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs">Open</span>}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={() => setExportModal({ format: "csv", busy: false })}
                        className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm font-bold"
                    >
                        <Download size={16} /> Export
                    </button>
                    <Link
                        href={`/admin/events/${event.id}/registrations`}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                        title="View registrations"
                    >
                        Registrations
                    </Link>
                    <Link
                        href={`/admin/events/${event.id}/attendance`}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                        title="View attendance"
                    >
                        Attendance
                    </Link>
                </div>
            </div>

            {/* Metrics Panel */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" role="group" aria-label="Feedback statistics">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-white">{feedbacks.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Total responses</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-blue-400">{avgRating}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Average rating</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-yellow-400">{event.feedbackCount ?? 0}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Count (server)</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-green-400">{filteredFeedbacks.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Visible (filtered)</p>
                </div>
            </div>

            {/* Workflow status badge */}
            <div className="mb-6 flex items-center gap-3">
                <span
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${state.status === "live"
                        ? "bg-green-500/15 text-green-400 border-green-500/25"
                        : state.status === "stopped"
                            ? "bg-red-500/15 text-red-400 border-red-500/25"
                            : "bg-gray-500/10 text-gray-500 border-gray-500/20"}`}
                    title={state.label}
                >
                    <MessageSquare size={12} /> Feedback: {state.label}
                </span>
                {state.status === "live" && (
                    <span className="text-xs text-green-400">Feedback is open for attendees.</span>
                )}
                {state.status === "stopped" && (
                    <span className="text-xs text-gray-400">Feedback is closed.</span>
                )}
            </div>

            {/* Search */}
            <div className="mb-6 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
                <input
                    type="text"
                    placeholder="Search by name or comment…"
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10 text-gray-400 uppercase text-xs font-bold tracking-wider">
                                <th className="p-4">Student</th>
                                <th className="p-4">Rating</th>
                                <th className="p-4">Comment</th>
                                <th className="p-4 text-right">Submitted at</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-sm">
                            {filteredFeedbacks.map((fb) => (
                                <tr key={fb.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4 align-top">
                                        <div className="font-bold text-white">{fb.userName}</div>
                                    </td>
                                    <td className="p-4 align-top font-mono text-blue-300">
                                        {fb.overallRating} / 5
                                    </td>
                                    <td className="p-4 align-top text-gray-300 line-clamp-2 max-w-xs">
                                        {fb.opinion || "—"}
                                    </td>
                                    <td className="p-4 text-right align-top text-gray-400 font-mono text-xs">
                                        {fb.submittedAt?.seconds ? new Date(fb.submittedAt.seconds * 1000).toLocaleString() : "—"}
                                    </td>
                                </tr>
                            ))}

                            {filteredFeedbacks.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-gray-500">
                                        No feedback responses found matching your search.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Export dialog */}
            {exportModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="export-title"
                >
                    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 id="export-title" className="text-lg font-bold text-white">Export feedback</h2>
                            <button type="button" onClick={() => setExportModal(null)} className="text-gray-400 hover:text-white" aria-label="Close">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">
                            Exporting <strong className="text-white">{event.title}</strong> — feedback
                        </p>
                        <div className="mb-5">
                            <label className="block text-sm font-semibold text-gray-300 mb-2">Select format</label>
                            <div className="grid grid-cols-2 gap-2">
                                {EXPORT_FORMATS.map(f => (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => setExportModal(prev => prev ? { ...prev, format: f.id } : null)}
                                        className={`px-3 py-2 rounded-lg text-sm border transition-colors ${exportModal?.format === f.id
                                            ? "bg-blue-600 border-blue-500 text-white"
                                            : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"}`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setExportModal(null)}
                                disabled={exportModal.busy}
                                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmExport}
                                disabled={exportModal.busy}
                                className="rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 transition-colors inline-flex items-center gap-2 disabled:opacity-40"
                            >
                                {exportModal.busy ? <Loader2 size={14} className="animate-spin" /> : "Download"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
