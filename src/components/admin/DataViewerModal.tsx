"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, Star, ChevronDown, Search } from "lucide-react";
import { getEvents, getEventRegistrations, getEventFeedbacks } from "@/lib/api";
import { Event, EventRegistration, Feedback } from "@/types";

type ModalType = "registrations" | "attendance" | "feedbacks";

interface DataViewerModalProps {
    type: ModalType;
    onClose: () => void;
}

export default function DataViewerModal({ type, onClose }: DataViewerModalProps) {
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [loadingData, setLoadingData] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const closeRef = useRef<HTMLButtonElement>(null);

    // Data states
    const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);

    const title = type === "registrations" ? "Registrations" : type === "attendance" ? "Attendance" : "Feedbacks";

    // Same dialog semantics as AvatarSelector: Escape and backdrop close,
    // focus lands on the close button so keyboard users aren't lost.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        closeRef.current?.focus();
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    useEffect(() => {
        (async () => {
            const data = await getEvents();
            const sorted = data.sort((a, b) => b.date.localeCompare(a.date));
            setEvents(sorted);
            setLoadingEvents(false);
        })();
    }, []);

    const handleSelectEvent = async (event: Event) => {
        setSelectedEvent(event);
        setLoadingData(true);
        setSearchTerm("");

        try {
            if (type === "registrations" || type === "attendance") {
                const regs = await getEventRegistrations(event.id);
                setRegistrations(regs);
            }
            if (type === "feedbacks") {
                const fb = await getEventFeedbacks(event.id);
                fb.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
                setFeedbacks(fb);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingData(false);
        }
    };

    // --- Derived data ---

    // For attendance: flatten registrations into individual attendees
    const attendees = registrations.flatMap(r => {
        const result: { name: string; rollNo: string; teamName: string; type: string }[] = [];

        // Leader / Individual
        const leaderAttended = (r.attendance && r.attendance[r.userId]) || r.status === "attended";
        if (leaderAttended) {
            result.push({
                name: r.userDetails.name,
                rollNo: r.userDetails.rollNo,
                teamName: r.teamName || "-",
                type: r.teamName ? "Team Leader" : "Individual"
            });
        }

        // Team Members
        if (r.teamMembers && r.teamMembers.length > 0) {
            r.teamMembers.forEach(member => {
                const memberId = member.userId;
                const memberAttended = memberId ? (r.attendance && r.attendance[memberId]) : false;
                if (memberAttended) {
                    result.push({
                        name: member.name,
                        rollNo: member.rollNo,
                        teamName: r.teamName || "-",
                        type: "Team Member"
                    });
                }
            });
        }

        return result;
    });

    // Filtered registrations (for search)
    const filteredRegistrations = registrations.filter(r =>
        !searchTerm ||
        r.userDetails.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.userDetails.rollNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.teamName && r.teamName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const filteredAttendees = attendees.filter(a =>
        !searchTerm ||
        a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.rollNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.teamName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredFeedbacks = feedbacks.filter(f =>
        !searchTerm ||
        f.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.opinion.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Feedback stats
    const fbStats = feedbacks.length > 0 ? {
        avg: (feedbacks.reduce((sum, f) => sum + f.overallRating, 0) / feedbacks.length).toFixed(1),
        count: feedbacks.length,
        breakdown: [5, 4, 3, 2, 1].map(star => ({
            star,
            count: feedbacks.filter(f => f.overallRating === star).length,
            percent: (feedbacks.filter(f => f.overallRating === star).length / feedbacks.length) * 100
        }))
    } : null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={`${title} data viewer`}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden relative shadow-2xl flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-2xl font-bold text-white">{title}</h2>
                        {selectedEvent && <p className="text-gray-400 text-sm mt-1">{selectedEvent.title} — {selectedEvent.date}</p>}
                    </div>
                    <button
                        ref={closeRef}
                        onClick={onClose}
                        aria-label={`Close ${title.toLowerCase()} viewer`}
                        className="p-2 bg-white/5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Event Selector */}
                <div className="p-4 border-b border-white/10 shrink-0">
                    {loadingEvents ? (
                        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="animate-spin" size={16} /> Loading events...</div>
                    ) : events.length === 0 ? (
                        <p className="text-gray-500">No events found.</p>
                    ) : (
                        <div className="flex gap-3 items-center">
                            <div className="relative flex-grow max-w-md">
                                <select
                                    value={selectedEvent?.id || ""}
                                    onChange={(e) => {
                                        const ev = events.find(ev => ev.id === e.target.value);
                                        if (ev) handleSelectEvent(ev);
                                    }}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 pr-10 text-white appearance-none focus:border-blue-500 outline-none cursor-pointer"
                                >
                                    <option value="" disabled>Select an event...</option>
                                    {events.map(ev => (
                                        <option key={ev.id} value={ev.id} className="bg-[#1a1a1a] text-white">
                                            {ev.title} ({ev.date}) — {ev.status.toUpperCase()}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            </div>

                            {selectedEvent && (
                                <div className="relative flex-grow max-w-xs">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                    <input
                                        type="text"
                                        placeholder="Search..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg p-3 pl-10 text-white focus:border-blue-500 outline-none"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-grow overflow-y-auto p-6">
                    {!selectedEvent ? (
                        <div className="text-center py-20 text-gray-500">
                            <p className="text-lg">Select an event to view {title.toLowerCase()}</p>
                        </div>
                    ) : loadingData ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="animate-spin text-blue-500" size={32} />
                        </div>
                    ) : (
                        <>
                            {/* ===== REGISTRATIONS ===== */}
                            {type === "registrations" && (
                                registrations.length === 0 ? (
                                    <div className="text-center py-20 text-gray-500">No registrations for this event.</div>
                                ) : (
                                    <div>
                                        <p className="text-sm text-gray-400 mb-4">
                                            Total: <span className="text-white font-bold">{registrations.length}</span> registration(s)
                                        </p>
                                        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                                            <table className="w-full text-left text-sm">
                                                <thead className="bg-white/5 text-gray-400 text-xs uppercase">
                                                    <tr>
                                                        <th className="p-3">#</th>
                                                        <th className="p-3">Name</th>
                                                        <th className="p-3">Roll No</th>
                                                        <th className="p-3">Class</th>
                                                        <th className="p-3">Section</th>
                                                        <th className="p-3">Mobile</th>
                                                        <th className="p-3">Team</th>
                                                        <th className="p-3">Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {filteredRegistrations.map((reg, i) => (
                                                        <tr key={reg.id || i} className="hover:bg-white/5">
                                                            <td className="p-3 text-gray-500">{i + 1}</td>
                                                            <td className="p-3 font-medium text-white">{reg.userDetails.name}</td>
                                                            <td className="p-3 text-gray-300">{reg.userDetails.rollNo}</td>
                                                            <td className="p-3 text-gray-400">{reg.userDetails.class || "-"}</td>
                                                            <td className="p-3 text-gray-400">{reg.userDetails.section || "-"}</td>
                                                            <td className="p-3 text-gray-400">{reg.userDetails.mobile || "-"}</td>
                                                            <td className="p-3 text-gray-400">{reg.teamName || "-"}</td>
                                                            <td className="p-3">
                                                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                                                    reg.status === "attended" ? "bg-green-500/20 text-green-400" :
                                                                    reg.status === "registered" ? "bg-blue-500/20 text-blue-400" :
                                                                    reg.status === "cancelled" ? "bg-red-500/20 text-red-400" :
                                                                    "bg-gray-500/20 text-gray-400"
                                                                }`}>{reg.status}</span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )
                            )}

                            {/* ===== ATTENDANCE ===== */}
                            {type === "attendance" && (
                                attendees.length === 0 ? (
                                    <div className="text-center py-20 text-gray-500">No attendance recorded for this event.</div>
                                ) : (
                                    <div>
                                        <p className="text-sm text-gray-400 mb-4">
                                            Attended: <span className="text-white font-bold">{attendees.length}</span> / {registrations.length} registered
                                        </p>
                                        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                                            <table className="w-full text-left text-sm">
                                                <thead className="bg-white/5 text-gray-400 text-xs uppercase">
                                                    <tr>
                                                        <th className="p-3">#</th>
                                                        <th className="p-3">Name</th>
                                                        <th className="p-3">Roll No</th>
                                                        <th className="p-3">Team</th>
                                                        <th className="p-3">Type</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {filteredAttendees.map((a, i) => (
                                                        <tr key={i} className="hover:bg-white/5">
                                                            <td className="p-3 text-gray-500">{i + 1}</td>
                                                            <td className="p-3 font-medium text-white">{a.name}</td>
                                                            <td className="p-3 text-gray-300">{a.rollNo}</td>
                                                            <td className="p-3 text-gray-400">{a.teamName}</td>
                                                            <td className="p-3">
                                                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                                                    a.type === "Individual" ? "bg-blue-500/20 text-blue-400" :
                                                                    a.type === "Team Leader" ? "bg-purple-500/20 text-purple-400" :
                                                                    "bg-cyan-500/20 text-cyan-400"
                                                                }`}>{a.type}</span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )
                            )}

                            {/* ===== FEEDBACKS ===== */}
                            {type === "feedbacks" && (
                                feedbacks.length === 0 ? (
                                    <div className="text-center py-20 text-gray-500">No feedback received for this event.</div>
                                ) : (
                                    <div>
                                        {/* Summary Stats */}
                                        {fbStats && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 bg-white/5 p-6 rounded-xl border border-white/10">
                                                <div className="flex items-center gap-6">
                                                    <div className="text-center">
                                                        <div className="text-5xl font-bold text-white mb-2">{fbStats.avg}</div>
                                                        <div className="flex gap-1 justify-center mb-1">
                                                            {[1, 2, 3, 4, 5].map(star => (
                                                                <Star key={star} size={16}
                                                                    className={star <= Math.round(parseFloat(fbStats.avg)) ? "text-yellow-400" : "text-gray-600"}
                                                                    fill={star <= Math.round(parseFloat(fbStats.avg)) ? "currentColor" : "none"}
                                                                />
                                                            ))}
                                                        </div>
                                                        <div className="text-gray-500 text-sm">{fbStats.count} Reviews</div>
                                                    </div>
                                                    <div className="h-24 w-px bg-white/10 mx-auto" />
                                                    <div className="flex-grow space-y-1">
                                                        {fbStats.breakdown.map((item) => (
                                                            <div key={item.star} className="flex items-center gap-2 text-xs">
                                                                <span className="w-3 text-gray-400">{item.star}</span>
                                                                <Star size={10} className="text-gray-500" />
                                                                <div className="flex-grow h-2 bg-white/5 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-yellow-500 transition-all" style={{ width: `${item.percent}%` }} />
                                                                </div>
                                                                <span className="w-6 text-gray-500 text-right">{item.count}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Feedback List */}
                                        <div className="space-y-4">
                                            {filteredFeedbacks.map((item) => (
                                                <div key={item.id} className="bg-white/5 border border-white/5 p-4 rounded-xl hover:bg-white/10 transition-colors">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                                                                {item.userName.charAt(0)}
                                                            </div>
                                                            <div>
                                                                <div className="font-bold text-white text-sm">{item.userName}</div>
                                                                <div className="text-xs text-gray-500">{item.submittedAt?.toDate?.()?.toLocaleString() || "-"}</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-1">
                                                            {[1, 2, 3, 4, 5].map(star => (
                                                                <Star key={star} size={12}
                                                                    className={star <= item.overallRating ? "text-yellow-400" : "text-gray-700"}
                                                                    fill={star <= item.overallRating ? "currentColor" : "none"}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <p className="text-gray-300 text-sm mt-2 leading-relaxed">{item.opinion}</p>
                                                    <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-500">
                                                        {Object.entries(item.matrixRatings).map(([key, val]) => (
                                                            <div key={key} className="flex justify-between">
                                                                <span className="capitalize">{key}:</span>
                                                                <span className="text-gray-300 font-bold">{val as number}/5</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
