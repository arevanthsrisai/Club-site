"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth";
import {
    getEvent,
    Event,
    AttendanceRecord,
    AttendanceSession,
    getEventAttendanceRecords,
    getEventAttendanceSessions,
} from "@/lib/api";
import { exportEventWorkflow, EXPORT_FORMATS, type ExportFormatId } from "@/services/eventWorkflows";
import {
    ArrowLeft, Download, Users, User, Clock, Search, X, Loader2,
} from "lucide-react";
import { workflowState } from "@/lib/workflow";

export default function EventAttendancePage() {
    const params = useParams<{ id: string }>();
    const [event, setEvent] = useState<Event | null>(null);
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [sessions, setSessions] = useState<AttendanceSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSessionId, setSelectedSessionId] = useState("all");
    const toast = useToast();

    // Export modal state
    const [exportModal, setExportModal] = useState<{
        format: ExportFormatId;
        busy: boolean;
    } | null>(null);

    useEffect(() => {
        async function fetchData() {
            if (params.id) {
                const [eventData, recsData, sessionsData] = await Promise.all([
                    getEvent(params.id),
                    getEventAttendanceRecords(params.id),
                    getEventAttendanceSessions(params.id),
                ]);
                setEvent(eventData);
                setRecords(recsData);
                setSessions(sessionsData);
            }
            setLoading(false);
        }
        fetchData();
    }, [params.id]);

    const state = useMemo(() => workflowState(event as any, "attendance"), [event]);

    // Filter records by session scope: "all" or a specific sessionId
    const filteredRecords = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return records.filter(rec => {
            const matchesSearch =
                rec.userName.toLowerCase().includes(q) ||
                rec.rollNo.toLowerCase().includes(q) ||
                rec.teamName?.toLowerCase().includes(q);
            const matchesSession =
                selectedSessionId === "all" || rec.sessionId === selectedSessionId;
            return matchesSearch && matchesSession;
        });
    }, [records, searchTerm, selectedSessionId]);

    const activeSession = sessions.find(s => s.id === event?.attendanceSessionId);

    const confirmExport = useCallback(async () => {
        if (!exportModal || !event) return;
        setExportModal(prev => prev ? { ...prev, busy: true } : null);
        try {
            await exportEventWorkflow(event.id, "attendance", exportModal.format, searchTerm);
            toast.success(`Attendance data exported as ${exportModal.format.toUpperCase()}.`);
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
                                {new Date(event.date).toLocaleDateString()} • Attendance
                                {event.attendanceStatus === "active" && <span className="ml-2 bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs">Active</span>}
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
                        href={`/admin/events/${event.id}/feedback`}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                        title="View feedback"
                    >
                        Feedback
                    </Link>
                </div>
            </div>

            {/* Metrics Panel */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" role="group" aria-label="Attendance statistics">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-white">{records.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Total check-ins</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-blue-400">{activeSession ? 1 : 0}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Active sessions</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-yellow-400">{sessions.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">All sessions</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-2xl font-bold text-green-400">{filteredRecords.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{selectedSessionId === "all" ? "Visible (all sessions)" : "Visible (this session)"}</p>
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
                    <Clock size={12} /> Attendance: {state.label}
                </span>
                {state.status === "live" && activeSession && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400" title="Current session code">
                        <Clock size={12} /> Code: {activeSession.code}
                    </span>
                )}
                {state.status === "stopped" && (
                    <span className="text-xs text-gray-400">No active session — start attendance to begin check-ins.</span>
                )}
            </div>

            {/* Session scope selector */}
            <div className="mb-6">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session scope</span>
                    <div className="flex gap-1 border border-white/10 rounded-xl bg-black/30 p-1">
                        <button
                            type="button"
                            onClick={() => setSelectedSessionId("all")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${selectedSessionId === "all"
                                ? "bg-blue-600 text-white"
                                : "text-gray-300 hover:bg-white/10 hover:text-white"}`}
                        >
                            All sessions
                        </button>
                        {sessions.map(s => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setSelectedSessionId(s.id)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${selectedSessionId === s.id
                                    ? "bg-blue-600 text-white"
                                    : "text-gray-300 hover:bg-white/10 hover:text-white"}`}
                            >
                                {s.id.split("_").pop()} ({s.endedAt ? "closed" : "active"})
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="mb-6 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
                <input
                    type="text"
                    placeholder="Search by name, roll number, or team…"
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
                                <th className="p-4">Roll No</th>
                                <th className="p-4">Team</th>
                                <th className="p-4">Session</th>
                                <th className="p-4 text-right">Checked in at</th>
                                <th className="p-4 text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-sm">
                            {filteredRecords.map((rec) => (
                                <tr key={rec.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4 align-top">
                                        <div className="font-bold text-white">{rec.userName}</div>
                                    </td>
                                    <td className="p-4 align-top font-mono text-blue-300">{rec.rollNo}</td>
                                    <td className="p-4 align-top text-gray-400">
                                        {rec.teamName || <span className="italic">—</span>}
                                    </td>
                                    <td className="p-4 align-top font-mono text-gray-300 text-xs">
                                        {rec.sessionId.split("_").pop()}
                                    </td>
                                    <td className="p-4 text-right align-top text-gray-400 font-mono text-xs">
                                        {rec.checkedInAt?.seconds ? new Date(rec.checkedInAt.seconds * 1000).toLocaleString() : "—"}
                                    </td>
                                    <td className="p-4 text-right align-top">
                                        <span className="px-2 py-1 rounded text-xs font-bold uppercase border bg-green-500/20 text-green-400 border-green-500/20">
                                            Checked in
                                        </span>
                                    </td>
                                </tr>
                            ))}

                            {filteredRecords.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-500">
                                        No attendance records found matching your search.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Session history panel */}
            {sessions.length > 0 && (
                <div className="mt-8 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
                    <h3 className="text-sm font-bold text-gray-300 mb-4 uppercase tracking-wider">Session history</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white/5 border-b border-white/10 text-gray-400 uppercase text-xs font-bold tracking-wider">
                                    <th className="p-4">Session</th>
                                    <th className="p-4">Started</th>
                                    <th className="p-4">Ended</th>
                                    <th className="p-4 text-right">Status</th>
                                    <th className="p-4 text-right">Check-ins</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 text-sm">
                                {sessions.map(s => {
                                    const recCount = records.filter(r => r.sessionId === s.id).length;
                                    const isClosed = Boolean(s.endedAt);
                                    return (
                                        <tr key={s.id} className="hover:bg-white/5 transition-colors">
                                            <td className="p-4 align-top font-mono text-gray-300 text-xs">
                                                {s.id.split("_").pop()}
                                            </td>
                                            <td className="p-4 align-top text-gray-400 font-mono text-xs">
                                                {s.startedAt?.seconds ? new Date(s.startedAt.seconds * 1000).toLocaleString() : "—"}
                                            </td>
                                            <td className="p-4 align-top text-gray-400 font-mono text-xs">
                                                {s.endedAt?.seconds ? new Date(s.endedAt.seconds * 1000).toLocaleString() : <span className="text-green-400">Active</span>}
                                            </td>
                                            <td className="p-4 text-right align-top">
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase border ${isClosed
                                                    ? "bg-red-500/20 text-red-400 border-red-500/20"
                                                    : "bg-green-500/20 text-green-400 border-green-500/20"
                                                }`}>
                                                    {isClosed ? "Closed" : "Active"}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right align-top font-mono text-gray-300">
                                                {recCount}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

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
                            <h2 id="export-title" className="text-lg font-bold text-white">Export attendance</h2>
                            <button type="button" onClick={() => setExportModal(null)} className="text-gray-400 hover:text-white" aria-label="Close">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">
                            Exporting <strong className="text-white">{event.title}</strong> — attendance
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
