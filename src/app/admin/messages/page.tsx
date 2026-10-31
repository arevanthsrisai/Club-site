"use client";

import { useState, useEffect, useMemo } from "react";
import { subscribeToMessages, deleteMessage, setMessageSolved, setMessageReminder } from "@/lib/api";
import { ContactMessage } from "@/types";
import { MessageSquare, Trash2, Mail, Clock, Search, Download, CheckCircle2, Circle, Bell, BellOff, XCircle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { convertToCSV } from "@/lib/csvUtils";

type MessageFilter = "all" | "unsolved" | "solved" | "reminders";

export default function MessagesPage() {
    const [messages, setMessages] = useState<ContactMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<MessageFilter>("all");

    useEffect(() => {
        const unsubscribe = subscribeToMessages((msgs) => {
            setMessages(msgs);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const filteredMessages = useMemo(() => {
        const now = Date.now();
        return messages.filter(m => {
            // Text search
            if (search) {
                const s = search.toLowerCase();
                if (
                    !m.name.toLowerCase().includes(s) &&
                    !m.email.toLowerCase().includes(s) &&
                    !m.subject.toLowerCase().includes(s) &&
                    !m.message.toLowerCase().includes(s)
                ) {
                    return false;
                }
            }
            // Status filter
            switch (filter) {
                case "unsolved":
                    return !m.solved;
                case "solved":
                    return m.solved === true;
                case "reminders":
                    return (
                        m.reminderAt != null &&
                        m.reminderAt.seconds * 1000 <= now
                    );
                default:
                    return true;
            }
        });
    }, [messages, search, filter]);

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure you want to delete this message?")) {
            await deleteMessage(id);
        }
    };

    const handleToggleSolved = async (msg: ContactMessage) => {
        const next = msg.solved ? false : true;
        await setMessageSolved(msg.id!, next);
    };

    const handleSetReminder = async (msg: ContactMessage) => {
        const alreadyPassed =
            msg.reminderAt != null && msg.reminderAt.seconds * 1000 <= Date.now();
        const nextSolved = msg.solved || alreadyPassed;

        if (nextSolved) {
            /* Clear the reminder */
            await setMessageReminder(msg.id!, null);
            return;
        }

        const hours = prompt(
            "Set reminder in hours (e.g. 24, 48):",
            msg.reminderAt ? String(Math.round((msg.reminderAt.seconds * 1000 - Date.now()) / 3600000)) : "24"
        );
        if (hours === null) return;
        const h = Number(hours);
        if (!Number.isFinite(h) || h <= 0) {
            alert("Please enter a positive number of hours.");
            return;
        }
        await setMessageReminder(msg.id!, new Date(Date.now() + h * 3600000));
    };

    const handleExport = () => {
        convertToCSV(
            filteredMessages.map(m => ({
                Name: m.name,
                Email: m.email,
                Subject: m.subject,
                Message: m.message,
                Status: m.solved ? "Solved" : "Unresolved",
                ReceivedAt: m.timestamp?.seconds
                    ? new Date(m.timestamp.seconds * 1000).toLocaleString("en-GB")
                    : "Unknown",
                AnsweredAt: m.solvedAt?.seconds
                    ? new Date(m.solvedAt.seconds * 1000).toLocaleString("en-GB")
                    : "",
                Reminder: m.reminderAt?.seconds
                    ? new Date(m.reminderAt.seconds * 1000).toLocaleString("en-GB")
                    : "",
            })),
            "Contact_Messages"
        );
    };

    const unsolvedCount = messages.filter(m => !m.solved).length;
    const reminderCount = messages.filter(m =>
        m.reminderAt != null && m.reminderAt.seconds * 1000 <= Date.now()
    ).length;

    const filterTabs: { key: MessageFilter; label: string; count?: number }[] = [
        { key: "all", label: "All" },
        { key: "unsolved", label: "Unresolved", count: unsolvedCount },
        { key: "solved", label: "Solved" },
        { key: "reminders", label: "Due Reminders", count: reminderCount },
    ];

    if (loading) return <div className="text-white">Loading messages...</div>;

    return (
        <div className="max-w-6xl mx-auto text-white">
            <PageHeader
                title="Inbox"
                subtitle="View, answer and track messages from the contact form."
                icon={<MessageSquare size={26} />}
                actions={
                    <>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                            <input
                                type="text"
                                placeholder="Search messages..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="bg-black/40 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none w-64"
                                aria-label="Search messages"
                            />
                        </div>
                        <button
                            onClick={handleExport}
                            disabled={filteredMessages.length === 0}
                            title="Export filtered messages to CSV"
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Download size={16} /> Export CSV
                        </button>
                    </>
                }
            />

            {/* Filter tabs */}
            <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1" role="tablist" aria-label="Message status filter">
                {filterTabs.map(tab => (
                    <button
                        key={tab.key}
                        role="tab"
                        aria-selected={filter === tab.key}
                        onClick={() => setFilter(tab.key)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            filter === tab.key
                                ? "bg-white/10 text-white"
                                : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                        }`}
                    >
                        {tab.label}
                        {tab.count != null && tab.count > 0 && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                                tab.key === "unsolved"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : tab.key === "reminders"
                                    ? "bg-blue-500/20 text-blue-300"
                                    : "bg-white/10 text-gray-300"
                            }`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {filteredMessages.length === 0 ? (
                <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/10 border-dashed">
                    <Mail size={48} className="mx-auto mb-4 text-gray-600" />
                    <h3 className="text-gray-500 font-bold">
                        {filter !== "all" ? "No matching messages" : "No messages found"}
                    </h3>
                    <p className="text-xs text-gray-600 mt-1">
                        {filter !== "all"
                            ? "Try switching to the All tab"
                            : "Contact form submissions appear here"}
                    </p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {filteredMessages.map((msg) => (
                        <MessageCard
                            key={msg.id}
                            msg={msg}
                            onDelete={() => handleDelete(msg.id!)}
                            onToggleSolved={() => handleToggleSolved(msg)}
                            onSetReminder={() => handleSetReminder(msg)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── Single message card ────────────────────────────────────────────────── */

function MessageCard({
    msg,
    onDelete,
    onToggleSolved,
    onSetReminder,
}: {
    msg: ContactMessage;
    onDelete: () => void;
    onToggleSolved: () => void;
    onSetReminder: () => void;
}) {
    const now = Date.now();
    const reminderDue = msg.reminderAt != null && msg.reminderAt.seconds * 1000 <= now;
    const reminderText = msg.reminderAt
        ? new Date(msg.reminderAt.seconds * 1000).toLocaleString("en-GB", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : null;

    const solvedAgo = msg.solvedAt
        ? timeSince(msg.solvedAt.seconds * 1000)
        : null;

    return (
        <div
            className={`group relative rounded-xl border p-6 transition-colors ${
                msg.solved
                    ? "border-white/5 bg-white/[0.03] opacity-70"
                    : "border-white/10 bg-white/5 hover:bg-white/[0.07]"
            } ${
                reminderDue
                    ? "border-blue-500/40 bg-blue-500/5"
                    : ""
            }`}
        >
            {/* Reminder due badge */}
            {reminderDue && (
                <div className="absolute -top-2 -right-2 flex items-center gap-1 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full shadow-lg" role="status" aria-label="Follow-up reminder due">
                    <Bell size={12} aria-hidden="true" />
                    Follow-up due
                </div>
            )}

            {/* Header */}
            <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        {/* Status icon */}
                        {msg.solved ? (
                            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" aria-label="Solved" />
                        ) : (
                            <Circle size={16} className="text-amber-400 shrink-0" aria-label="Unresolved" />
                        )}
                        <h3 className={`font-bold text-lg truncate ${msg.solved ? "text-gray-400 line-through" : "text-white"}`}>
                            {msg.subject}
                        </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                        <span className="font-semibold text-blue-400">{msg.name}</span>
                        <span className="flex items-center gap-1">
                            <Mail size={13} /> {msg.email}
                        </span>
                        <span className="flex items-center gap-1">
                            <Clock size={13} />{" "}
                            {msg.timestamp
                                ? new Date(msg.timestamp.seconds * 1000).toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                })
                                : "Unknown"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Message body */}
            <div className="bg-black/20 rounded-lg p-4 text-gray-300 whitespace-pre-wrap font-sans text-sm leading-relaxed border border-white/5 mb-4">
                {msg.message}
            </div>

            {/* Action footer */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {/* Solved toggle */}
                    <button
                        onClick={onToggleSolved}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            msg.solved
                                ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20"
                                : "bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10 hover:text-white"
                        }`}
                        title={msg.solved ? "Mark as unresolved" : "Mark as solved"}
                        aria-label={msg.solved ? "Mark as unresolved" : "Mark as solved"}
                    >
                        {msg.solved ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                        {msg.solved ? "Solved" : "Mark Solved"}
                        {solvedAgo && ` (${solvedAgo})`}
                    </button>

                    {/* Reminder */}
                    <button
                        onClick={onSetReminder}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            reminderDue
                                ? "bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25"
                                : msg.reminderAt
                                ? "bg-blue-500/10 text-blue-200 border border-blue-500/20 hover:bg-blue-500/15"
                                : "bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10 hover:text-white"
                        }`}
                        title={
                            reminderDue
                                ? "Clear due reminder"
                                : msg.reminderAt
                                ? "Clear reminder"
                                : "Set follow-up reminder"
                        }
                        aria-label={
                            reminderDue
                                ? "Clear due reminder"
                                : msg.reminderAt
                                ? "Clear reminder"
                                : "Set follow-up reminder"
                        }
                    >
                        {reminderDue || !msg.reminderAt ? <Bell size={13} /> : <BellOff size={13} />}
                        {reminderDue
                            ? "Due — Clear"
                            : msg.reminderAt
                            ? `Reminder: ${reminderText} · Clear`
                            : "Set Reminder"}
                    </button>
                </div>

                {/* Delete */}
                <button
                    onClick={onDelete}
                    className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    title="Delete Message"
                    aria-label="Delete message"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );
}

/* ── Utility ────────────────────────────────────────────────────────────── */

function timeSince(ts: number): string {
    const seconds = Math.round((Date.now() - ts) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
}
