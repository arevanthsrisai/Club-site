"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { getEventRegistrationCounts, Event, createEvent, deleteEvent, subscribeToEvents, logActivity } from "@/lib/api";
import { Plus, Edit2, Trash2, Copy, RefreshCw, Users, Calendar, Search, AlertCircle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";

const STATUS_FILTERS = ["all", "upcoming", "ongoing", "past"] as const;

export default function EventsAdmin() {
    const [events, setEvents] = useState<Event[]>([]);
    const [loading, setLoading] = useState(true);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
    const [regFilter, setRegFilter] = useState<"all" | "open" | "closed" | "upcoming">("all");
    const [deleting, setDeleting] = useState<Event | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    const { profile } = useAuth();
    const toast = useToast();

    useEffect(() => {
        // Debounced search so typing doesn't re-render the whole table per key.
        const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        setError(null);
        const unsubscribe = subscribeToEvents((data) => {
            setEvents(data);
            setLoading(false);
        }, () => {
            setLoading(false);
            setError("Could not load events. Firestore may be unreachable — try the refresh button.");
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    // Registration counts (real aggregate counts, one query per event).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const next = await getEventRegistrationCounts(events.map(e => e.id));
                if (!cancelled) setCounts(next);
            } catch (e) {
                console.warn("Registration counts unavailable:", e);
            }
        })();
        return () => { cancelled = true; };
    }, [events]);

    const visible = useMemo(() => {
        return events.filter(e => {
            if (statusFilter !== "all" && e.status !== statusFilter) return false;
            if (regFilter !== "all" && (e.registrationStatus || "upcoming") !== regFilter) return false;
            if (search && !`${e.title} ${e.venue ?? ""}`.toLowerCase().includes(search)) return false;
            return true;
        });
    }, [events, search, statusFilter, regFilter]);

    const confirmDelete = async () => {
        if (!deleting || deleteBusy) return;
        setDeleteBusy(true);
        try {
            await deleteEvent(deleting.id);
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Deleted event: ${deleting.title}`);
            toast.success("Event deleted.");
            setDeleting(null);
        } catch (e: any) {
            toast.error(e?.message || "Delete failed.");
        } finally {
            setDeleteBusy(false);
        }
    };

    const handleClone = async (event: Event) => {
        if (!confirm(`Clone "${event.title}"?`)) return;

        // Remove ID and append (Copy) to title. Lifecycle resets so the copy
        // goes through the normal draft → publish flow.
        const { id, ...rest } = event;
        const newEvent = {
            ...rest,
            title: `${event.title} (Copy)`,
            status: "upcoming" as const,
            registrationStatus: "upcoming" as const,
            attendanceStatus: "upcoming" as const,
            feedbackStatus: "upcoming" as const,
            isFeedbackOpen: false,
            avgRating: 0,
            feedbackCount: 0,
        };

        await createEvent(newEvent);
        await logActivity(profile?.uid!, profile?.displayName || "Admin", `Cloned event: ${event.title}`);

        toast.success("Event cloned successfully!");
    };

    return (
        <div>
            <PageHeader
                title="Manage Events"
                subtitle="Create, publish and monitor club events."
                icon={<Calendar size={26} />}
                actions={
                    <>
                        <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 rounded-full text-green-400 text-xs font-mono animate-pulse border border-green-500/20">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            LIVE
                        </div>
                        <Link
                            href="/admin/events/new"
                            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                        >
                            <Plus size={18} />
                            <span>Add Event</span>
                        </Link>
                    </>
                }
            />

            {loading ? (
                <div className="space-y-2" role="status" aria-label="Loading events">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
                    ))}
                </div>
            ) : (
                <>
                    {error && (
                        <p role="alert" className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-sm text-red-300 flex items-center gap-2">
                            <AlertCircle size={15} /> {error}
                        </p>
                    )}

                <div className="grid grid-cols-3 gap-4 mb-8">
                    <StatChip label="Upcoming" value={events.filter(e => e.status === 'upcoming').length} tone="blue" />
                    <StatChip label="Ongoing" value={events.filter(e => e.status === 'ongoing').length} tone="green" />
                    <StatChip label="Past" value={events.filter(e => e.status === 'past').length} tone="gray" />
                </div>

                {/* Search + filters */}
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                        <input
                            type="search"
                            aria-label="Search events"
                            placeholder="Search event title or venue…"
                            className={`w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 pl-9 text-sm text-white focus:border-blue-500 outline-none`}
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                        />
                    </div>
                    <select
                        aria-label="Filter by event status"
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white sm:w-44"
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                    >
                        {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}</option>)}
                    </select>
                    <select
                        aria-label="Filter by registration status"
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white sm:w-56"
                        value={regFilter}
                        onChange={e => setRegFilter(e.target.value as typeof regFilter)}
                    >
                        <option value="all">Any registration state</option>
                        <option value="open">Registration open</option>
                        <option value="closed">Registration closed</option>
                        <option value="upcoming">Registration not started</option>
                    </select>
                </div>

                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto backdrop-blur-sm">
                    <table className="w-full text-left border-collapse min-w-[720px]">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10 text-gray-400 uppercase text-sm">
                                <th className="p-4 font-medium">Title</th>
                                <th className="p-4 font-medium">Date</th>
                                <th className="p-4 font-medium">Status</th>
                                <th className="p-4 font-medium">Registration</th>
                                <th className="p-4 font-medium text-right">Registrations</th>
                                <th className="p-4 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {visible.map((event) => (
                                <tr key={event.id} className="hover:bg-white/5 transition-colors">
                                    <td className="p-4 font-medium text-white">
                                        {event.title}
                                        {event.venue && <p className="text-xs text-gray-500 mt-0.5">{event.venue}</p>}
                                    </td>
                                    <td className="p-4 text-gray-300">{event.date}</td>
                                    <td className="p-4">
                                        <span className={`inline-block px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${event.status === 'upcoming' ? 'bg-green-500/20 text-green-400' : event.status === 'ongoing' ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-gray-500/20 text-gray-400'}`}>
                                            {event.status}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-block px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                                            (event.registrationStatus || "upcoming") === 'open'
                                                ? 'bg-blue-500/20 text-blue-400'
                                                : (event.registrationStatus || "upcoming") === 'closed'
                                                    ? 'bg-red-500/10 text-red-400'
                                                    : 'bg-white/10 text-gray-500'
                                        }`}>
                                            {event.registrationStatus || "upcoming"}
                                        </span>
                                        {(event.minTeamSize ?? 1) > 1 && (
                                            <p className="text-[11px] text-gray-500 mt-1">team {event.minTeamSize}–{event.maxTeamSize ?? event.minTeamSize}</p>
                                        )}
                                    </td>
                                    <td className="p-4 text-right text-gray-300">
                                        {counts[event.id] ?? "…"}
                                    </td>
                                    <td className="p-4 text-right space-x-2 flex justify-end">
                                        <Link
                                            href={`/admin/events/${event.id}/registrations`}
                                            className="text-green-400 hover:text-green-300 p-2 rounded hover:bg-white/5"
                                            title="View Registrations"
                                            aria-label={`View registrations for ${event.title}`}
                                        >
                                            <Users size={18} />
                                        </Link>
                                        <button
                                            onClick={() => handleClone(event)}
                                            className="text-yellow-400 hover:text-yellow-300 p-2 rounded hover:bg-white/5"
                                            title="Clone Event"
                                            aria-label={`Clone ${event.title}`}
                                        >
                                            <Copy size={18} />
                                        </button>
                                        <Link href={`/admin/events/${event.id}`} className="text-blue-400 hover:text-blue-300 p-2 rounded hover:bg-white/5" title="Edit" aria-label={`Edit ${event.title}`}>
                                            <Edit2 size={18} />
                                        </Link>
                                        <button
                                            onClick={() => setDeleting(event)}
                                            className="text-red-400 hover:text-red-300 p-2 rounded hover:bg-white/5"
                                            title="Delete"
                                            aria-label={`Delete ${event.title}`}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {visible.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-500">
                                        {search || statusFilter !== "all" || regFilter !== "all"
                                            ? "No events match the current filters."
                                            : <>No events found. Click &quot;Add Event&quot; to create one.</>}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                </>
            )}

            {/* Delete confirmation dialog */}
            {deleting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-event-title">
                    <div className="bg-[#0c0c14] border border-red-500/30 rounded-xl p-6 w-full max-w-md">
                        <h2 id="delete-event-title" className="text-lg font-bold mb-2 flex items-center gap-2 text-red-400"><Trash2 size={18} /> Delete event</h2>
                        <p className="text-sm text-gray-300">
                            Permanently delete <strong>{deleting.title}</strong>? The event document is removed; its
                            registrations, attendance and feedback remain as historical records.
                        </p>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => !deleteBusy && setDeleting(null)} className="px-4 py-2 text-gray-400 hover:text-white" disabled={deleteBusy}>Cancel</button>
                            <button onClick={confirmDelete} disabled={deleteBusy} className="px-5 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2">
                                {deleteBusy ? "Deleting…" : "Delete permanently"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: "blue" | "green" | "gray" }) {
    const tones = {
        blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        green: "bg-green-500/10 text-green-400 border-green-500/20",
        gray: "bg-white/5 text-gray-400 border-white/10",
    };
    return (
        <div className={`px-4 py-3 rounded-xl border ${tones[tone]}`}>
            <p className="text-2xl font-bold leading-none">{value}</p>
            <p className="text-xs uppercase tracking-wider mt-1.5 opacity-80">{label}</p>
        </div>
    );
}
