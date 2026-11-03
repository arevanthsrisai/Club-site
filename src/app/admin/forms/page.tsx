"use client";

/**
 * Event management — /admin/forms.
 *
 * Admins create events, and the system automatically provides Registration,
 * Attendance, and Feedback workflows for each event. Standalone form creation
 * is no longer supported.
 *
 * Features:
 * - Event cards with workflow status badges
 * - Restart/Reset controls for each workflow
 * - Multi-format exports (CSV, Excel, PDF, Word, JSON, TXT, HTML)
 * - Search and filter
 * - Confirmation dialogs for destructive actions
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import {
    subscribeToEvents, updateEvent, logActivity,
} from "@/lib/api";
import type { Event as EventType } from "@/types";
import {
    ClipboardList, Plus, Search, Users, CheckCircle, MessageSquare, Loader2, AlertCircle,
    RotateCcw, Calendar, FileSpreadsheet, Play, StopCircle, ExternalLink, MoreVertical,
    Download, Trash2, RefreshCw, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { executeWorkflowAction, exportEventWorkflow, EXPORT_FORMATS, type WorkflowType, type ExportFormatId } from "@/services/eventWorkflows";
import { workflowState, WORKFLOW_LABELS } from "@/lib/workflow";

type StatusFilter = "all" | "upcoming" | "ongoing" | "past";

const METRIC_CARDS = [
    { key: "total", label: "Total events", color: "text-white" },
    { key: "upcoming", label: "Upcoming", color: "text-blue-400" },
    { key: "ongoing", label: "Live now", color: "text-green-400" },
    { key: "registrations", label: "Total registrations", color: "text-amber-400" },
] as const;

export default function EventsAdminPage() {
    const toast = useToast();
    const { profile } = useAuth();
    const [events, setEvents] = useState<EventType[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [deleting, setDeleting] = useState<EventType | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [regCounts, setRegCounts] = useState<Record<string, number>>({});

    // Workflow action modal state
    const [workflowModal, setWorkflowModal] = useState<{
        event: EventType;
        workflow: WorkflowType;
        action: "restart" | "stop" | "reset";
        busy: boolean;
    } | null>(null);

    // Export modal state
    const [exportModal, setExportModal] = useState<{
        event: EventType;
        workflow: WorkflowType;
        format: ExportFormatId;
        busy: boolean;
    } | null>(null);

    useEffect(() => {
        const unsub = subscribeToEvents(
            data => { setEvents(data); setLoading(false); setLoadError(false); },
            () => { setLoading(false); setLoadError(true); }
        );
        return () => unsub();
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Fetch registration counts for all events
    useEffect(() => {
        if (events.length === 0) return;
        let cancelled = false;
        import("@/lib/api").then(({ getEventRegistrationCounts }) =>
            getEventRegistrationCounts(events.map(e => e.id))
                .then(next => { if (!cancelled) setRegCounts(next); })
                .catch(err => console.warn("Registration counts unavailable:", err))
        );
        return () => { cancelled = true; };
    }, [events]);

    const metrics = useMemo(() => {
        const totalRegs = Object.values(regCounts).reduce((sum, c) => sum + c, 0);
        return {
            total: events.length,
            upcoming: events.filter(e => e.status === "upcoming").length,
            ongoing: events.filter(e => e.status === "ongoing").length,
            registrations: totalRegs,
        };
    }, [events, regCounts]);

    const visible = useMemo(() => {
        let list = events;
        if (statusFilter !== "all") list = list.filter(e => e.status === statusFilter);
        if (search) {
            const q = search;
            list = list.filter(e =>
                `${e.title} ${e.venue ?? ""}`.toLowerCase().includes(q)
            );
        }
        return list;
    }, [events, statusFilter, search]);

    const handleDelete = async () => {
        if (!deleting) return;
        setDeleteBusy(true);
        try {
            const { deleteEvent } = await import("@/lib/api");
            await deleteEvent(deleting.id);
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Deleted event: ${deleting.title}`);
            toast.success("Event deleted.");
            setDeleting(null);
        } catch (err: any) {
            toast.error(err?.message || "Could not delete the event.");
        } finally {
            setDeleteBusy(false);
        }
    };

    const handleLifecycle = async (event: EventType, action: "start" | "end" | "toggle-reg" | "toggle-attendance" | "toggle-feedback") => {
        try {
            switch (action) {
                case "start":
                    await updateEvent(event.id, { status: "ongoing", registrationStatus: "closed" });
                    await logActivity(profile?.uid!, profile?.displayName || "Admin", `Started event: ${event.title}`);
                    toast.success(`Event "${event.title}" marked as ongoing.`);
                    break;
                case "end":
                    await updateEvent(event.id, { status: "past", registrationStatus: "closed", attendanceStatus: "ended" });
                    await logActivity(profile?.uid!, profile?.displayName || "Admin", `Ended event: ${event.title}`);
                    toast.success(`Event "${event.title}" ended.`);
                    break;
                case "toggle-reg": {
                    const next = event.registrationStatus === "open" ? "closed" : "open";
                    await updateEvent(event.id, { registrationStatus: next });
                    await logActivity(profile?.uid!, profile?.displayName || "Admin", `${next === "open" ? "Opened" : "Closed"} registration: ${event.title}`);
                    toast.success(`Registration ${next === "open" ? "opened" : "closed"}.`);
                    break;
                }
                case "toggle-attendance": {
                    const { startAttendance, stopAttendance } = await import("@/lib/api");
                    if (event.attendanceStatus === "active") {
                        await stopAttendance(event.id);
                        await logActivity(profile?.uid!, profile?.displayName || "Admin", `Stopped attendance: ${event.title}`);
                        toast.success("Attendance stopped.");
                    } else {
                        const code = Math.floor(1000 + Math.random() * 9000).toString();
                        await startAttendance(event.id, code);
                        await logActivity(profile?.uid!, profile?.displayName || "Admin", `Started attendance: ${event.title}`);
                        toast.success(`Attendance started. Code: ${code}`);
                    }
                    break;
                }
                case "toggle-feedback": {
                    const next = event.isFeedbackOpen ? false : true;
                    await updateEvent(event.id, { isFeedbackOpen: next, feedbackStatus: next ? "active" : "ended" });
                    await logActivity(profile?.uid!, profile?.displayName || "Admin", `${next ? "Opened" : "Closed"} feedback: ${event.title}`);
                    toast.success(`Feedback ${next ? "opened" : "closed"}.`);
                    break;
                }
            }
        } catch (err: any) {
            toast.error(err?.message || "Could not complete the action.");
        }
    };

    const openWorkflowModal = useCallback((event: EventType, workflow: WorkflowType, action: "restart" | "stop" | "reset") => {
        setWorkflowModal({ event, workflow, action, busy: false });
    }, []);

    const confirmWorkflowAction = useCallback(async () => {
        if (!workflowModal) return;
        const { event, workflow, action } = workflowModal;
        setWorkflowModal({ ...workflowModal, busy: true });

        try {
            const result = await executeWorkflowAction(event.id, workflow, action);
            toast.success(result.message);
            setWorkflowModal(null);
        } catch (err: any) {
            toast.error(err?.message || "Action failed.");
        } finally {
            setWorkflowModal(prev => prev ? { ...prev, busy: false } : null);
        }
    }, [workflowModal, toast]);

    const openExportModal = useCallback((event: EventType, workflow: WorkflowType) => {
        setExportModal({ event, workflow, format: "csv", busy: false });
    }, []);

    const confirmExport = useCallback(async () => {
        if (!exportModal) return;
        const { event, workflow, format } = exportModal;
        setExportModal({ ...exportModal, busy: true });

        try {
            await exportEventWorkflow(event.id, workflow, format);
            toast.success(`${workflow} data exported as ${format.toUpperCase()}.`);
            setExportModal(null);
        } catch (err: any) {
            toast.error(err?.message || "Export failed.");
        } finally {
            setExportModal(prev => prev ? { ...prev, busy: false } : null);
        }
    }, [exportModal, toast]);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Events & Workflows"
                subtitle="Manage Registration, Attendance, and Feedback for every event."
                icon={<Calendar size={26} />}
                actions={
                    <Link
                        href="/admin/events/new"
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <Plus size={18} />
                        <span>Create Event</span>
                    </Link>
                }
            />

            {/* Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="Event statistics">
                {METRIC_CARDS.map(card => (
                    <div key={card.key} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <p className={`text-2xl font-bold ${card.color}`}>
                            {metrics[card.key].toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{card.label}</p>
                    </div>
                ))}
            </div>

            {/* Search + filter row */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 sm:max-w-md">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                    <input
                        type="search"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder="Search events…"
                        aria-label="Search events by title or venue"
                        className="w-full rounded-xl bg-white/5 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60"
                    />
                </div>
                <div className="flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1 self-start" role="group" aria-label="Filter by status">
                    {(["all", "upcoming", "ongoing", "past"] as StatusFilter[]).map(s => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setStatusFilter(s)}
                            aria-pressed={statusFilter === s}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${statusFilter === s ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"}`}
                        >
                            {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="space-y-2" role="status">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" style={{ opacity: 1 - i * 0.2 }} />
                    ))}
                </div>
            ) : loadError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
                    <AlertCircle size={28} className="mx-auto mb-3 text-red-400" />
                    <p className="text-sm text-red-300 mb-3">Events could not be loaded.</p>
                    <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-white/10 border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition-colors">
                        <RotateCcw size={14} className="inline mr-1.5" /> Try again
                    </button>
                </div>
            ) : visible.length === 0 && events.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-10 text-center">
                    <Calendar size={40} className="mx-auto mb-4 text-gray-500" />
                    <h2 className="text-lg font-bold text-white mb-1">No events yet</h2>
                    <p className="text-sm text-gray-400 mb-5">Create your first event with Registration, Attendance, and Feedback workflows.</p>
                    <Link href="/admin/events/new" className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
                        <Plus size={16} /> Create Event
                    </Link>
                </div>
            ) : visible.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-10 text-center text-sm text-gray-400">
                    No events match the current search or filter.
                </div>
            ) : (
                <ul className="space-y-3" aria-label="Events list">
                    {visible.map(event => (
                        <li
                            key={event.id}
                            className="rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-5 hover:border-white/20 transition-colors"
                        >
                            <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                {/* Event info */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-bold text-white truncate">{event.title}</h3>
                                        <StatusBadge status={event.status} />
                                    </div>
                                    {event.description && (
                                        <p className="text-sm text-gray-400 line-clamp-2 mt-0.5">{event.description}</p>
                                    )}
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                                        <span>{event.date}</span>
                                        {event.venue && <span>📍 {event.venue}</span>}
                                        <span className="inline-flex items-center gap-1 text-amber-500/90">
                                            <Users size={12} /> {regCounts[event.id] ?? "…"} registrations
                                        </span>
                                    </div>

                                    {/* Workflow status indicators */}
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <WorkflowBadge
                                            icon={<ClipboardList size={12} />}
                                            label="Registration"
                                            workflow="registration"
                                            event={event}
                                        />
                                        <WorkflowBadge
                                            icon={<CheckCircle size={12} />}
                                            label="Attendance"
                                            workflow="attendance"
                                            event={event}
                                        />
                                        <WorkflowBadge
                                            icon={<MessageSquare size={12} />}
                                            label="Feedback"
                                            workflow="feedback"
                                            event={event}
                                        />
                                    </div>
                                </div>

                                {/* Actions menu */}
                                <div className="flex flex-wrap items-center gap-2 lg:justify-end shrink-0">
                                    <EventActions
                                        event={event}
                                        onLifecycle={handleLifecycle}
                                        onWorkflowAction={openWorkflowModal}
                                        onExport={openExportModal}
                                        onDelete={setDeleting}
                                    />
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <p className="flex items-center gap-2 text-xs text-gray-500">
                <ExternalLink size={13} />
                Advanced lifecycle management at{" "}
                <Link href="/admin/events/lifecycle" className="text-blue-400 hover:underline">/admin/events/lifecycle</Link>.
            </p>

            {/* Delete confirmation dialog */}
            {deleting && (
                <ConfirmDialog
                    title="Delete event"
                    message={
                        <>
                            Permanently delete <strong className="text-white">{deleting.title}</strong>?
                            Its registrations, attendance and feedback remain as historical records.
                        </>
                    }
                    confirmLabel={deleteBusy ? "Deleting…" : "Delete permanently"}
                    onCancel={() => setDeleting(null)}
                    onConfirm={handleDelete}
                    busy={deleteBusy}
                    variant="danger"
                />
            )}

            {/* Workflow action modal */}
            {workflowModal && (
                <ConfirmDialog
                    title={
                        workflowModal.action === "stop"
                            ? `Stop ${workflowModal.workflow}`
                            : workflowModal.action === "restart"
                                ? `Restart ${workflowModal.workflow}`
                                : `Reset ${workflowModal.workflow}`
                    }
                    message={
                        workflowModal.action === "stop" ? (
                            <>
                                Stop <strong className="text-white">{workflowModal.workflow}</strong> for{" "}
                                <strong className="text-white">{workflowModal.event.title}</strong>?
                                <p className="mt-2 text-sm text-amber-400">
                                    This will close the workflow and prevent new submissions.
                                    Existing data will be preserved.
                                </p>
                            </>
                        ) : workflowModal.action === "restart" ? (
                            <>
                                Restart <strong className="text-white">{workflowModal.workflow}</strong> for{" "}
                                <strong className="text-white">{workflowModal.event.title}</strong>?
                                <p className="mt-2 text-sm text-gray-400">
                                    This will {workflowModal.workflow === "registration" ? "reopen registration" : workflowModal.workflow === "attendance" ? "start a new attendance session" : "reopen feedback"}
                                    . All existing data will be preserved.
                                </p>
                            </>
                        ) : (
                            <>
                                Reset <strong className="text-white">{workflowModal.workflow}</strong> for{" "}
                                <strong className="text-white">{workflowModal.event.title}</strong>?
                                <p className="mt-2 text-sm text-red-400">
                                    ⚠️ This will <strong>permanently delete all {workflowModal.workflow} data</strong> for this event. This action cannot be undone.
                                </p>
                            </>
                        )
                    }
                    confirmLabel={
                        workflowModal.busy
                            ? "Processing…"
                            : workflowModal.action === "stop"
                                ? "Stop"
                                : workflowModal.action === "restart"
                                    ? "Restart"
                                    : "Reset"
                    }
                    onCancel={() => setWorkflowModal(null)}
                    onConfirm={confirmWorkflowAction}
                    busy={workflowModal.busy}
                    variant={
                        workflowModal.action === "reset"
                            ? "danger"
                            : workflowModal.action === "stop"
                                ? "warning"
                                : "primary"
                    }
                />
            )}

            {/* Export modal */}
            {exportModal && (
                <ExportDialog
                    event={exportModal.event}
                    workflow={exportModal.workflow}
                    format={exportModal.format}
                    onFormatChange={(format) => setExportModal(prev => prev ? { ...prev, format } : null)}
                    onCancel={() => setExportModal(null)}
                    onExport={confirmExport}
                    busy={exportModal.busy}
                />
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        upcoming: "bg-blue-500/15 text-blue-400 border-blue-500/25",
        ongoing: "bg-green-500/15 text-green-400 border-green-500/25",
        past: "bg-gray-500/15 text-gray-400 border-gray-500/25",
    };
    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles[status] ?? styles.past}`}>
            {status}
        </span>
    );
}

function WorkflowBadge({ icon, label, workflow, event }: { icon: React.ReactNode; label: string; workflow: WorkflowType; event: EventType | null | undefined }) {
    const state = workflowState(event as any, workflow);
    const styles = state.status === "live"
        ? "bg-green-500/15 text-green-400 border-green-500/25"
        : state.status === "stopped"
            ? "bg-red-500/15 text-red-400 border-red-500/25"
            : "bg-gray-500/10 text-gray-500 border-gray-500/20";
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles}`} title={state.label}>
            {icon} {label}: {state.label}
        </span>
    );
}

function EventActions({
    event,
    onLifecycle,
    onWorkflowAction,
    onExport,
    onDelete,
}: {
    event: EventType;
    onLifecycle: (event: EventType, action: "start" | "end" | "toggle-reg" | "toggle-attendance" | "toggle-feedback") => void;
    onWorkflowAction: (event: EventType, workflow: "registration" | "attendance" | "feedback", action: "restart" | "stop" | "reset") => void;
    onExport: (event: EventType, workflow: "registration" | "attendance" | "feedback") => void;
    onDelete: (event: EventType) => void;
}) {
    const [menuOpen, setMenuOpen] = useState<{ workflow: WorkflowType } | null>(null);

    return (
        <>
            <Link
                href={`/admin/events/${event.id}/registrations`}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                title="View registrations"
            >
                Registrations
            </Link>
            <Link
                href={`/admin/events/${event.id}`}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                title="Edit event"
            >
                Edit
            </Link>
            {event.status === "upcoming" && (
                <button
                    type="button"
                    onClick={() => onLifecycle(event, "start")}
                    className="rounded-lg bg-green-600/90 px-3 py-2 text-xs font-semibold text-white hover:bg-green-500 transition-colors inline-flex items-center gap-1.5"
                    title="Start event"
                >
                    <Play size={13} /> Start
                </button>
            )}
            {event.status === "ongoing" && (
                <button
                    type="button"
                    onClick={() => onLifecycle(event, "end")}
                    className="rounded-lg bg-amber-600/80 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 transition-colors inline-flex items-center gap-1.5"
                    title="End event"
                >
                    <StopCircle size={13} /> End
                </button>
            )}

            {/* More actions dropdown for workflow management */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setMenuOpen(menuOpen ? null : { workflow: "registration" })}
                    className="rounded-lg border border-white/10 bg-white/5 p-2 text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                    aria-label="Workflow actions"
                    aria-expanded={!!menuOpen}
                >
                    <MoreVertical size={16} />
                </button>

                {menuOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-gray-900 shadow-lg z-50">
                            <div className="p-2">
                                <p className="text-xs font-semibold text-gray-400 px-2 py-1">Workflows</p>
                                {(["registration", "attendance", "feedback"] as WorkflowType[]).map(wf => {
                                    const state = workflowState(event, wf);
                                    return (
                                        <div key={wf} className="mt-1">
                                            <button
                                                type="button"
                                                className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-white/5 rounded-lg capitalize"
                                                onClick={() => setMenuOpen({ workflow: wf })}
                                            >
                                                {wf}
                                            </button>
                                            <div className="px-2 pb-1 space-y-1">
                                                {state.status === "live" ? (
                                                    <button
                                                        type="button"
                                                        disabled={!state.canStop}
                                                        className="w-full text-left px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/10 rounded flex items-center gap-1.5 disabled:opacity-50"
                                                        onClick={() => { setMenuOpen(null); onWorkflowAction(event, wf, "stop"); }}
                                                        title="Stop workflow"
                                                    >
                                                        <StopCircle size={12} /> Stop {WORKFLOW_LABELS[wf].label}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={!state.canRestart}
                                                        className="w-full text-left px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/10 rounded flex items-center gap-1.5 disabled:opacity-50"
                                                        onClick={() => { setMenuOpen(null); onWorkflowAction(event, wf, "restart"); }}
                                                        title="Restart workflow"
                                                    >
                                                        <RefreshCw size={12} /> {state.status === "not-started" ? "Start" : "Restart"} {WORKFLOW_LABELS[wf].label}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className="w-full text-left px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded flex items-center gap-1.5"
                                                    onClick={() => { setMenuOpen(null); onWorkflowAction(event, wf, "reset"); }}
                                                >
                                                    <Trash2 size={12} /> Reset {WORKFLOW_LABELS[wf].label}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="w-full text-left px-2 py-1 text-xs text-green-400 hover:bg-green-500/10 rounded flex items-center gap-1.5"
                                                    onClick={() => { setMenuOpen(null); onExport(event, wf); }}
                                                >
                                                    <Download size={12} /> Export
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>

            <button
                type="button"
                onClick={() => onDelete(event)}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-colors"
                title="Delete event"
            >
                <Trash2 size={14} />
            </button>
        </>
    );
}

function ConfirmDialog({
    title,
    message,
    confirmLabel,
    onCancel,
    onConfirm,
    busy,
    variant = "primary",
}: {
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
    busy: boolean;
    variant?: "primary" | "danger" | "warning";
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
        >
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6">
                <h2 id="dialog-title" className="text-lg font-bold text-white flex items-center gap-2">
                    {variant === "danger" && <AlertCircle size={18} className="text-red-400" />}
                    {title}
                </h2>
                <div className="mt-3 text-sm text-gray-300">{message}</div>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition-colors inline-flex items-center gap-2 disabled:opacity-40 ${variant === "danger" ? "bg-red-600 hover:bg-red-500" : variant === "warning" ? "bg-amber-600 hover:bg-amber-500" : "bg-blue-600 hover:bg-blue-500"}`}
                    >
                        {busy && <Loader2 size={14} className="animate-spin" />}
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ExportDialog({
    event,
    workflow,
    format,
    onFormatChange,
    onCancel,
    onExport,
    busy,
}: {
    event: EventType;
    workflow: WorkflowType;
    format: ExportFormatId;
    onFormatChange: (f: ExportFormatId) => void;
    onCancel: () => void;
    onExport: () => void;
    busy: boolean;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
        >
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 id="export-title" className="text-lg font-bold text-white">Export {workflow} data</h2>
                    <button type="button" onClick={onCancel} className="text-gray-400 hover:text-white" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>
                <p className="text-sm text-gray-400 mb-4">
                    Exporting <strong className="text-white">{event.title}</strong> — {workflow}
                </p>
                <div className="mb-5">
                    <label className="block text-sm font-semibold text-gray-300 mb-2">Select format</label>
                    <div className="grid grid-cols-2 gap-2">
                        {EXPORT_FORMATS.map(f => (
                            <button
                                key={f.id}
                                type="button"
                                onClick={() => onFormatChange(f.id)}
                                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${format === f.id
                                        ? "bg-blue-600 border-blue-500 text-white"
                                        : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
                                    }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onExport}
                        disabled={busy}
                        className="rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 transition-colors inline-flex items-center gap-2 disabled:opacity-40"
                    >
                        {busy && <Loader2 size={14} className="animate-spin" />}
                        {busy ? "Generating…" : "Download"}
                    </button>
                </div>
            </div>
        </div>
    );
}