"use client";

import { useState, useEffect } from "react";
import { getEvents, getEventRegistrations } from "@/lib/api";
import { Event, EventRegistration } from "@/types";
import { Calendar, Download, Search, User, ArrowLeft, Users, RefreshCw, Database } from "lucide-react";
import JsPDF from "jspdf";
import PageHeader from "@/components/ui/PageHeader";
import autoTable from "jspdf-autotable";

export default function RegistrationsPage() {
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [fetchingRegs, setFetchingRegs] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        loadEvents();
    }, []);

    const loadEvents = async () => {
        try {
            const data = await getEvents();
            // Sort by upcoming first
            const sorted = data.sort((a, b) => b.date.localeCompare(a.date));
            setEvents(sorted);
        } catch (error) {
            console.error(error);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectEvent = async (event: Event) => {
        setSelectedEvent(event);
        setFetchingRegs(true);
        try {
            const regs = await getEventRegistrations(event.id);
            setRegistrations(regs);
        } catch (error) {
            console.error(error);
        } finally {
            setFetchingRegs(false);
        }
    };

    const exportToPDF = () => {
        if (!selectedEvent) return;

        const doc = new JsPDF();

        // Header
        doc.setFontSize(20);
        doc.text(selectedEvent.title, 14, 22);

        doc.setFontSize(11);
        doc.text(`Date: ${selectedEvent.date}`, 14, 30);
        doc.text(`Total Registrations: ${registrations.length}`, 14, 36);

        const tableColumn = ["Roll No", "Name", "Class", "Section", "Mobile"];
        const tableRows = registrations.map(reg => [
            reg.userDetails.rollNo,
            reg.userDetails.name,
            reg.userDetails.class,
            reg.userDetails.section,
            reg.userDetails.mobile
        ]);

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 44,
        });

        doc.save(`${selectedEvent.title.replace(/\s+/g, '_')}_registrations.pdf`);
    };

    const filteredRegistrations = registrations.filter(reg =>
        reg.userDetails.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        reg.userDetails.rollNo.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return (
            <div className="max-w-6xl mx-auto text-white">
                <PageHeader
                    title="Registrations"
                    subtitle="Choose an event to view its registrations."
                    icon={<Calendar size={26} />}
                    actions={<span className="bg-white/5 text-gray-500 font-bold py-2 px-4 rounded-lg flex items-center gap-2 border border-white/10" aria-hidden="true">Select</span>}
                />
                {/* Skeleton grid mirrors the event-card layout so there is no layout jump. */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 p-6 rounded-xl">
                            <div className="h-6 w-3/4 rounded bg-white/10 animate-pulse mb-2" />
                            <div className="h-4 w-1/3 rounded bg-white/10 animate-pulse mb-4" />
                            <div className="h-6 w-24 rounded-full bg-white/10 animate-pulse" />
                        </div>
                    ))}
                </div>
                <span className="sr-only" role="status">Loading events…</span>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="min-h-[60vh] max-w-6xl mx-auto text-white flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-6">
                    <Database size={32} />
                </div>
                <h2 className="text-2xl font-bold mb-2">Couldn&apos;t load events</h2>
                <p className="text-gray-400 max-w-md mb-8">Something went wrong while fetching events. Try again.</p>
                <button
                    onClick={() => { setLoading(true); setLoadError(false); loadEvents(); }}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors"
                >
                    <RefreshCw size={16} /> Retry
                </button>
            </div>
        );
    }

    if (!selectedEvent) {
        return (
            <div className="max-w-6xl mx-auto text-white">
                <PageHeader
                    title="Select an Event"
                    subtitle="Choose an event to view its registrations."
                    icon={<Calendar size={26} />}
                />
                {events.length === 0 ? (
                    <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-gray-400">
                        <Calendar size={40} className="mx-auto mb-4 text-gray-600" aria-hidden="true" />
                        <p className="font-bold text-white mb-1">No events yet</p>
                        <p className="text-sm">Create an event first — its registrations will appear here.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {events.map(event => (
                            <button
                                key={event.id}
                                type="button"
                                onClick={() => handleSelectEvent(event)}
                                aria-label={`View registrations for ${event.title}`}
                                className="text-left bg-white/5 border border-white/10 p-6 rounded-xl hover:bg-white/10 cursor-pointer transition-all hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-blue-400"
                            >
                                <h2 className="text-xl font-bold mb-2 line-clamp-1">{event.title}</h2>
                                <div className="flex items-center gap-2 text-gray-400 text-sm mb-4">
                                    <Calendar size={16} aria-hidden="true" /> {event.date}
                                </div>
                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${event.status === 'upcoming' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                                    {event.status === 'upcoming' ? 'Upcoming' : 'Past'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const attendedCount = registrations.filter(r => r.status === 'attended').length;
    const cancelledCount = registrations.filter(r => r.status === 'cancelled').length;

    return (
        <div className="max-w-7xl mx-auto text-white">
            {/* Header */}
            <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-6 gap-4">
                <div>
                    <button
                        onClick={() => setSelectedEvent(null)}
                        className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-2 transition-colors"
                    >
                        <ArrowLeft size={14} aria-hidden="true" /> Back to Events
                    </button>
                    <h1 className="text-3xl font-bold">{selectedEvent.title}</h1>
                    <p className="text-blue-400 mt-1">{selectedEvent.date}</p>
                </div>
                {/* Registration stats */}
                <div className="flex gap-3 shrink-0">
                    <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-3 text-center">
                        <p className="text-xs text-gray-400 mb-0.5">Total</p>
                        <p className="text-2xl font-bold text-blue-400" aria-label={`${registrations.length} total registrations`}>{registrations.length}</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-3 text-center">
                        <p className="text-xs text-gray-400 mb-0.5">Attended</p>
                        <p className="text-2xl font-bold text-purple-400">{attendedCount}</p>
                    </div>
                    <div className="hidden sm:block bg-white/5 border border-white/10 rounded-xl px-5 py-3 text-center">
                        <p className="text-xs text-gray-400 mb-0.5">Cancelled</p>
                        <p className="text-2xl font-bold text-red-400">{cancelledCount}</p>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                    <label htmlFor="reg-search" className="sr-only">Search registrations by name or roll number</label>
                    <input
                        id="reg-search"
                        type="text"
                        placeholder="Search student name or roll number..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                </div>
                <button
                    onClick={exportToPDF}
                    disabled={filteredRegistrations.length === 0}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Download size={18} aria-hidden="true" /> Export PDF
                </button>
            </div>

            {/* Table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                {fetchingRegs ? (
                    <div className="h-64 flex flex-col items-center justify-center gap-3 text-gray-400" role="status">
                        <RefreshCw size={24} className="animate-spin text-blue-500" aria-hidden="true" />
                        Loading registrations...
                    </div>
                ) : filteredRegistrations.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center gap-3 text-gray-400">
                        <Users size={32} className="text-gray-600" aria-hidden="true" />
                        {registrations.length === 0
                            ? <p>No registrations for this event yet.</p>
                            : <p>No students match “{searchTerm}”.</p>}
                    </div>
                ) : (
                    <div className="overflow-x-auto h-full">
                        <table className="w-full text-left">
                            <thead className="bg-black/20 text-gray-400 text-xs uppercase sticky top-0">
                                <tr>
                                    <th className="px-6 py-4 font-bold">Student Name</th>
                                    <th className="px-6 py-4 font-bold">Roll Number</th>
                                    <th className="px-6 py-4 font-bold">Class</th>
                                    <th className="px-6 py-4 font-bold">Section</th>
                                    <th className="px-6 py-4 font-bold">Mobile</th>
                                    <th className="px-6 py-4 font-bold">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredRegistrations.map((reg) => (
                                    <tr key={reg.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4 font-medium">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs">
                                                    {reg.userDetails.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <div>{reg.userDetails.name}</div>
                                                    {reg.teamName && (
                                                        <div className="text-xs text-blue-400 font-bold mt-0.5">
                                                            Team: {reg.teamName} <span className="text-gray-500 font-normal">({reg.teamMembers?.length} members)</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-sm text-gray-300">{reg.userDetails.rollNo}</td>
                                        <td className="px-6 py-4 text-gray-300">{reg.userDetails.class}</td>
                                        <td className="px-6 py-4 text-gray-300">{reg.userDetails.section}</td>
                                        <td className="px-6 py-4 text-gray-300 font-mono text-sm">{reg.userDetails.mobile}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-bold uppercase border ${reg.status === 'attended'
                                                    ? 'bg-purple-500/20 text-purple-400 border-purple-500/20'
                                                    : reg.status === 'cancelled'
                                                        ? 'bg-red-500/20 text-red-400 border-red-500/20'
                                                        : 'bg-green-500/20 text-green-400 border-green-500/20'
                                                }`}>
                                                {reg.status}
                                            </span>
                                            {reg.feedbackSubmitted && (
                                                <span className="ml-2 px-2 py-1 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded text-xs font-bold">
                                                    Feedback
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
