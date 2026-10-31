"use client";

import { ClipboardList, MessageSquare, Play, StopCircle, CheckCircle, Trash2, Download, FileSpreadsheet, Search, Users } from "lucide-react";
import DataViewerModal from "@/components/admin/DataViewerModal";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { useState, useEffect, useMemo } from "react";
import { getEvents, updateEvent, logActivity, purgeEventData, getEventRegistrations, getEventRegistrationCounts, startAttendance, stopAttendance, getAttendanceCode } from "@/lib/api";
import { convertToCSV } from "@/lib/csvUtils";

import { Event } from "@/types";
import { useAuth } from "@/lib/auth";

export default function FormsDashboard() {
    const [events, setEvents] = useState<Event[]>([]);
    const [loading, setLoading] = useState(true);
    const [attendanceCodes, setAttendanceCodes] = useState<Record<string, string>>({});
    const [regCounts, setRegCounts] = useState<Record<string, number>>({});
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const { profile } = useAuth();

    const [activeModal, setActiveModal] = useState<'registrations' | 'attendance' | 'feedbacks' | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        if (events.length === 0) return;
        let cancelled = false;
        getEventRegistrationCounts(events.map(e => e.id))
            .then(next => { if (!cancelled) setRegCounts(next); })
            .catch(err => console.warn("Registration counts unavailable:", err));
        return () => { cancelled = true; };
    }, [events]);

    const loadData = async () => {
        const data = await getEvents();

        // Stats are now computed per-event inside the modal

        // Sort: Active/Open events first, then by date
        const sorted = data.sort((a, b) => {
            // Priority 0: ONGOING (Live) Events
            if (a.status === 'ongoing' && b.status !== 'ongoing') return -1;
            if (a.status !== 'ongoing' && b.status === 'ongoing') return 1;

            // Priority 1: Registration Open
            if (a.registrationStatus === 'open' && b.registrationStatus !== 'open') return -1;
            if (a.registrationStatus !== 'open' && b.registrationStatus === 'open') return 1;

            // Priority 2: Upcoming vs Past
            if (a.status === 'upcoming' && b.status === 'past') return -1;
            if (a.status === 'past' && b.status === 'upcoming') return 1;

            // Priority 3: Date (Newest first)
            return b.date.localeCompare(a.date);
        });
        setEvents(sorted);

        const active = sorted.filter(e => e.attendanceStatus === 'active');
        const codes = await Promise.all(active.map(e => getAttendanceCode(e.id)));
        setAttendanceCodes(Object.fromEntries(active.map((e, i) => [e.id, codes[i] || ''])));
        setLoading(false);
    };

    const visible = useMemo(() => {
        if (!search) return events;
        return events.filter(e => `${e.title} ${e.venue ?? ""}`.toLowerCase().includes(search));
    }, [events, search]);

    // Helper: Check if event date is fully in the past (Yesterday or before)
    const isEventPast = (dateStr: string) => {
        const eventDate = new Date(dateStr);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // If event is today, it's NOT past. Logic: Past means "Previous days".
        return eventDate < today;
    };

    const handleStartEvent = async (event: Event) => {
        if (!confirm(`Start Event "${event.title}"?\n\nThis will mark the event as ONGOING and CLOSE registrations.\n\nNote: You must manually click "START" under Attendance when you are ready.`)) return;

        // 1. Set Status to Ongoing
        // 2. Close Registrations
        // 3. DO NOT start attendance automatically.

        await updateEvent(event.id, {
            status: 'ongoing',
            registrationStatus: 'closed'
        });

        await logActivity(profile?.uid!, profile?.displayName || "Admin", `Started Event (Ongoing): ${event.title}`);
        loadData();
    };

    const handleEndEvent = async (event: Event) => {
        if (!confirm(`End Event "${event.title}"?\n\nThis will mark the event as PAST.`)) return;
        await updateEvent(event.id, { status: 'past', registrationStatus: 'closed', attendanceStatus: 'ended' });
        await logActivity(profile?.uid!, profile?.displayName || "Admin", `Ended Event: ${event.title}`);
        loadData();
    };

    const handleToggleRegistration = async (event: Event) => {
        // ... (existing logic)
        // 1. Warn if event is past (Yesterday or before)
        if (isEventPast(event.date)) {
            if (!confirm(`This event is in the past (${event.date}). Are you sure you want to modify registration?`)) return;
        }

        // 2. Logic: Open/Close toggle
        if (!event.registrationStatus || event.registrationStatus === 'upcoming') {
            if (!confirm(`Open registrations for "${event.title}"?`)) return;
            await updateEvent(event.id, { registrationStatus: 'open' });
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Opened registrations for: ${event.title}`);
        } else if (event.registrationStatus === 'open') {
            if (!confirm(`Close registrations for "${event.title}"?`)) return;
            await updateEvent(event.id, { registrationStatus: 'closed' });
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Closed registrations for: ${event.title}`);
        } else if (event.registrationStatus === 'closed') {
            if (!confirm(`Re-open registrations for "${event.title}"?`)) return;
            await updateEvent(event.id, { registrationStatus: 'open' });
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Re-opened registrations for: ${event.title}`);
        }
        loadData();
    };

    const handleToggleAttendance = async (event: Event) => {
        if (isEventPast(event.date)) {
            if (!confirm(`This event is in the past. Modify attendance anyway?`)) return;
        }

        // ONE-WAY FLOW -> Now Cyclical (Restartable)
        const currentStatus = event.attendanceStatus || 'upcoming';

        if (currentStatus === 'upcoming' || currentStatus === 'ended') {
            // Start / Restart
            const action = currentStatus === 'ended' ? "RESTART" : "Start";
            const code = Math.floor(1000 + Math.random() * 9000).toString();

            if (!confirm(`${action} attendance for "${event.title}"? New Code: ${code}`)) return;

            await startAttendance(event.id, code);
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `${action}ed attendance for: ${event.title}`);
        } else {
            if (!confirm(`STOP attendance for "${event.title}"?`)) return;
            await stopAttendance(event.id);
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Ended attendance for: ${event.title}`);
        }
        loadData();
    };

    const handleToggleFeedback = async (event: Event) => {
        if (isEventPast(event.date)) {
            if (!confirm(`This event is in the past. Modify feedback anyway?`)) return;
        }

        const currentStatus = event.feedbackStatus || (event.isFeedbackOpen ? 'active' : 'upcoming');

        if (currentStatus === 'upcoming' || currentStatus === 'ended') {
            const action = currentStatus === 'ended' ? "RE-OPEN" : "Open";
            if (!confirm(`${action} feedback for "${event.title}"?`)) return;

            await updateEvent(event.id, { isFeedbackOpen: true, feedbackStatus: 'active' });
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `${action}ed feedback for: ${event.title}`);
        } else if (currentStatus === 'active') {
            if (!confirm(`CLOSE feedback for "${event.title}"?`)) return;
            await updateEvent(event.id, { isFeedbackOpen: false, feedbackStatus: 'ended' });
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Closed feedback for: ${event.title}`);
        }
        loadData();
    };

    const handleDownloadCSV = async (event: Event) => {
        const regs = await getEventRegistrations(event.id);
        if (regs.length === 0) {
            alert("No registrations found for this event.");
            return;
        }

        // Flatten data for CSV (Include Team Members)
        const csvData: any[] = [];

        regs.forEach(r => {
            // 1. Leader / Individual
            const isLeaderAttended = (r.attendance && r.attendance[r.userId]) || r.status === 'attended';
            const isLeaderFeedback = (r.feedbackMap && r.feedbackMap[r.userId]) || (r.feedbackSubmitted && !r.teamName); // Fallback for legacy individuals

            csvData.push({
                Type: r.teamName ? 'Team Leader' : 'Individual',
                TeamName: r.teamName || '-',
                Name: r.userDetails.name,
                RollNo: r.userDetails.rollNo,
                Mobile: r.userDetails.mobile,
                Class: r.userDetails.class || '-',
                Section: r.userDetails.section || '-',
                Status: isLeaderAttended ? 'Attended' : r.status,
                Feedback: isLeaderFeedback ? 'Yes' : 'No',
                RegisteredAt: r.registeredAt?.toDate().toLocaleString() || '-'
            });

            // 2. Team Members
            if (r.teamMembers && r.teamMembers.length > 0) {
                r.teamMembers.forEach(member => {
                    const memberId = member.userId;
                    const isMemberAttended = memberId ? (r.attendance && r.attendance[memberId]) : false;
                    const isMemberFeedback = memberId ? (r.feedbackMap && r.feedbackMap[memberId]) : false;

                    csvData.push({
                        Type: 'Team Member',
                        TeamName: r.teamName || '-',
                        Name: member.name,
                        RollNo: member.rollNo,
                        Mobile: '-', // Not stored in teamMembers array usually
                        Class: '-',
                        Section: '-',
                        Status: isMemberAttended ? 'Attended' : 'Registered',
                        Feedback: isMemberFeedback ? 'Yes' : 'No',
                        RegisteredAt: r.registeredAt?.toDate().toLocaleString() || '-'
                    });
                });
            }
        });

        convertToCSV(csvData, `${event.title.replace(/\s+/g, '_')}_Report`);
    };

    return (
        <div className="max-w-6xl mx-auto text-white">
            <PageHeader
                title="Forms & Data"
                subtitle="Registrations, attendance and feedback for every event."
                icon={<FileSpreadsheet size={26} />}
            />

            {/* Quick Stats / Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <button onClick={() => setActiveModal('registrations')} className="group p-6 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all hover:scale-[1.02] text-left">
                    <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center mb-4 text-blue-400 group-hover:scale-110 transition-transform">
                        <ClipboardList size={24} />
                    </div>
                    <h2 className="text-xl font-bold mb-2">Registrations</h2>
                    <p className="text-gray-400 text-sm">View registrations by event.</p>
                </button>

                <button onClick={() => setActiveModal('attendance')} className="group p-6 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all hover:scale-[1.02] text-left">
                    <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center mb-4 text-green-400 group-hover:scale-110 transition-transform">
                        <CheckCircle size={24} />
                    </div>
                    <h2 className="text-xl font-bold mb-2">Attendance</h2>
                    <p className="text-gray-400 text-sm">View attended students by event.</p>
                </button>

                <button onClick={() => setActiveModal('feedbacks')} className="group p-6 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all hover:scale-[1.02] text-left">
                    <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center mb-4 text-purple-400 group-hover:scale-110 transition-transform">
                        <MessageSquare size={24} />
                    </div>
                    <h2 className="text-xl font-bold mb-2">Feedbacks</h2>
                    <p className="text-gray-400 text-sm">View feedback submissions by event.</p>
                </button>
            </div>

            <h2 className="text-2xl font-bold mb-4">Event Lifecycle Manager</h2>
            <div className="relative mb-4">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                <input
                    type="search"
                    aria-label="Search events in the lifecycle manager"
                    placeholder="Search event title or venue…"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 pl-9 text-sm text-white focus:border-blue-500 outline-none"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                />
            </div>
            {/* overflow-x-auto so narrow screens scroll the table instead of clipping it. */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
                <table className="w-full text-left min-w-[860px]">
                    <thead className="bg-white/5 text-gray-400 text-xs uppercase">
                        <tr>
                            <th className="p-4">Event</th>
                            <th className="p-4">Status</th>
                            <th className="p-4">Registration</th>
                            <th className="p-4">Attendance</th>
                            <th className="p-4">Feedback</th>
                            <th className="p-4 text-right">Registered</th>
                            <th className="p-4">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                        {loading ? (
                            <tr aria-hidden="true"><td colSpan={7} className="p-8">
                                <div className="space-y-3">
                                    {Array.from({ length: 4 }).map((_, i) => (
                                        <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" style={{ width: `${96 - i * 7}%` }} />
                                    ))}
                                </div>
                            </td></tr>
                        ) : events.length === 0 ? (
                            <tr><td colSpan={7} className="p-10 text-center text-gray-500">
                                No events yet. Create one from <Link href="/admin/events/new" className="text-blue-400 hover:text-blue-300 underline">Events → New</Link>.
                            </td></tr>
                        ) : events.map(event => (
                            <tr key={event.id} className="hover:bg-white/5">
                                <td className="p-4">
                                    <p className="font-bold">{event.title}</p>
                                    <p className="text-xs text-gray-400">{event.date}</p>
                                </td>
                                <td className="p-4">
                                    <div className="flex flex-col gap-2 items-start">
                                        <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${event.status === 'ongoing' ? 'bg-green-500 text-black animate-pulse' :
                                            (event.status === 'upcoming' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400')
                                            }`}>
                                            {event.status}
                                        </span>

                                        {event.status === 'upcoming' && (
                                            <button
                                                onClick={() => handleStartEvent(event)}
                                                className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                                                title="Mark as ONGOING"
                                            >
                                                <Play size={12} fill="currentColor" /> Start Event
                                            </button>
                                        )}
                                        {event.status === 'ongoing' && (
                                            <button
                                                onClick={() => handleEndEvent(event)}
                                                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                                                title="End Event"
                                            >
                                                <StopCircle size={12} fill="currentColor" /> End Event
                                            </button>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4">
                                    <button
                                        onClick={() => handleToggleRegistration(event)}
                                        className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${event.registrationStatus === 'open'
                                            ? 'bg-green-500/20 text-green-400 border-green-500/50 hover:bg-green-500/30'
                                            : (event.registrationStatus === 'closed' ? 'bg-red-500/20 text-red-400 border-red-500/50' : 'bg-gray-500/20 text-gray-400 border-white/10 hover:border-white/30')
                                            }`}
                                    >
                                        {event.registrationStatus === 'open' ? 'OPEN' : (event.registrationStatus === 'closed' ? 'CLOSED' : 'NOT STARTED')}
                                    </button>
                                </td>
                                <td className="p-4">
                                    <button
                                        onClick={() => handleToggleAttendance(event)}
                                        disabled={!event.registrationStatus || event.registrationStatus === 'upcoming'}
                                        className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-bold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${event.attendanceStatus === 'active'
                                            ? 'bg-purple-500/20 text-purple-400 border-purple-500/50 hover:bg-purple-500/30'
                                            : (event.attendanceStatus === 'ended' ? 'bg-gray-500/10 text-gray-500 border-gray-600 hover:border-white/50 hover:text-white' : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/30')
                                            }`}
                                    >
                                        {event.attendanceStatus === 'ended' ? 'RESTART' : (
                                            event.attendanceStatus === 'active' ? <><StopCircle size={14} /> STOP ({attendanceCodes[event.id]})</> : <><Play size={14} /> START</>
                                        )}
                                    </button>
                                </td>
                                <td className="p-4 text-right text-gray-300">
                                    <Link
                                        href={`/admin/events/${event.id}/registrations`}
                                        className="inline-flex items-center gap-1.5 text-sm hover:text-blue-400 transition-colors"
                                        title="Open the registered students list"
                                    >
                                        <Users size={13} /> {regCounts[event.id] ?? "…"}
                                    </Link>
                                </td>
                                <td className="p-4">
                                    <button
                                        onClick={() => handleToggleFeedback(event)}
                                        disabled={!event.registrationStatus || event.registrationStatus === 'upcoming'}
                                        className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-bold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${event.feedbackStatus === 'active' || (event.isFeedbackOpen && !event.feedbackStatus)
                                            ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50 hover:bg-yellow-500/30'
                                            : (event.feedbackStatus === 'ended' ? 'bg-gray-500/10 text-gray-500 border-gray-600 hover:border-white/50 hover:text-white' : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/30')
                                            }`}
                                    >
                                        {event.feedbackStatus === 'ended' ? 'RESTART' : (
                                            event.feedbackStatus === 'active' || event.isFeedbackOpen ? <><StopCircle size={14} /> STOP</> : <><Play size={14} /> START</>
                                        )}
                                    </button>
                                </td>

                                <td className="p-4 flex gap-2">
                                    <button
                                        onClick={() => handleDownloadCSV(event)}
                                        className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                        title="Download All Registrations"
                                        aria-label={`Download all registrations for ${event.title}`}
                                    >
                                        <Download size={16} aria-hidden="true" />
                                    </button>

                                    <button
                                        onClick={() => setActiveModal('feedbacks')}
                                        className="p-2 text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                                        title="View Feedback"
                                        aria-label={`View feedback submissions (opens the feedback viewer)`}
                                    >
                                        <MessageSquare size={16} aria-hidden="true" />
                                    </button>

                                    {profile?.role === 'CTO' && (
                                        <button
                                            onClick={async () => {
                                                const confirmation = prompt(`DANGER: PURGE DATA for "${event.title}"?\n\nThis will DELETE ALL registrations, attendance, and feedback.\nThe "Final Rating" will be SAVED and preserved.\n\nType "CONFIRM" to proceed.`);
                                                if (confirmation === "CONFIRM") {
                                                    await purgeEventData(event.id);
                                                    alert("Data purged. Final Rating preserved.");
                                                    loadData();
                                                }
                                            }}
                                            className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                            title="Purge Data (Keep Rating)"
                                            aria-label={`Purge data for ${event.title} (keeps final rating)`}
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {activeModal && (
                <DataViewerModal
                    type={activeModal}
                    onClose={() => setActiveModal(null)}
                />
            )}
        </div>
    );
}
