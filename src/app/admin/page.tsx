"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    subscribeToEvents,
    subscribeToAllAdmins,
    subscribeToPendingRegistrations,
    subscribeToTotalUsers,
    getEventRegistrationCounts,
    getResources,
    subscribeToMessages,
} from "@/lib/api";
import type { ContactMessage, Event, PendingRegistration, Resource } from "@/types";
import {
    attentionItems,
    upcomingEvents,
    summarizeEvents,
    type AttentionItem,
    type EventsSummary,
} from "@/lib/dashboardInsights";
import { summarizeMessages, dueReminders, type MessageLike } from "@/lib/messageWorkflow";
import PageHeader from "@/components/ui/PageHeader";
import {
    LayoutDashboard, CalendarCheck, Users, Globe, Inbox, TriangleAlert,
    MessageSquare, BookOpen, Plus, ChevronRight, ScanSearch, Bell,
} from "lucide-react";

/**
 * Admin overview: every number on this page comes from a live Firestore
 * subscription or an aggregate count query against the same collections the
 * management pages use — nothing is hardcoded. Reads are the exact ones
 * Firestore rules already allow admins; no extra privileges and no mutations.
 */
export default function AdminDashboard() {
    const [events, setEvents] = useState<Event[] | null>(null);
    const [eventsError, setEventsError] = useState(false);
    const [pendingRegs, setPendingRegs] = useState<PendingRegistration[] | null>(null);
    const [userCount, setUserCount] = useState<number | null>(null);
    const [messages, setMessages] = useState<ContactMessage[] | null>(null);

    useEffect(() => {
        const unsubs = [
            subscribeToEvents(
                (list) => { setEvents(list); setEventsError(false); },
                () => { setEventsError(true); setEvents(null); }
            ),
            subscribeToPendingRegistrations((list) => setPendingRegs(list)),
            subscribeToTotalUsers((count) => setUserCount(count)),
            subscribeToMessages((list) => setMessages(list)),
        ];
        return () => unsubs.forEach((unsub) => unsub());
    }, []);

    const summary = useMemo<EventsSummary | null>(
        () => (events ? summarizeEvents(events) : null),
        [events]
    );
    const queue = useMemo<AttentionItem[]>(
        () => (events && pendingRegs
            ? attentionItems(events, pendingRegs.map((r) => ({ uid: r.id, email: r.email })))
            : []),
        [events, pendingRegs]
    );
    const upcoming = useMemo(() => (events ? upcomingEvents(events) : []), [events]);

    return (
        <div className="space-y-8">
            <PageHeader
                title="Dashboard"
                icon={<LayoutDashboard size={26} />}
                subtitle="Live overview of the club — every metric tracks the same collections you manage."
                actions={
                    <Link
                        href="/admin/events/new"
                        className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold text-sm transition-colors focus-visible:ring-2 focus-visible:ring-blue-400"
                    >
                        <Plus size={16} aria-hidden="true" /> New Event
                    </Link>
                }
            />

            <MetricRow
                events={summary}
                userCount={userCount}
                pendingCount={pendingRegs?.length ?? null}
                messages={messages}
            />

            <ActionQueue items={queue} ready={!!events && !!pendingRegs} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <UpcomingEventsPanel
                    events={upcoming}
                    loading={events === null}
                    hasError={eventsError}
                />
                <MessagesPanel messages={messages} />
            </div>

            <ResourcePanel />
        </div>
    );
}

/* ── Metric cards ───────────────────────────────────────────────────────── */

type MetricColor = "blue" | "purple" | "yellow" | "amber";

const METRIC_TONES: Record<MetricColor, string> = {
    blue: "border-blue-500/25 bg-blue-500/10 text-blue-400",
    purple: "border-purple-500/25 bg-purple-500/10 text-purple-400",
    yellow: "border-yellow-500/25 bg-yellow-500/10 text-yellow-400",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-400",
};

function MetricCard({
    href, title, value, icon, color, note, loading,
}: {
    href: string;
    title: string;
    value: number | null;
    icon: React.ReactNode;
    color: MetricColor;
    note?: string;
    loading: boolean;
}) {
    return (
        <Link
            href={href}
            className="group p-5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all focus-visible:ring-2 focus-visible:ring-blue-400 outline-none"
            aria-label={`${title}: ${loading ? "loading" : value ?? 0}`}
        >
            <div className="flex items-center justify-between mb-3">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${METRIC_TONES[color]}`} aria-hidden="true">
                    {icon}
                </span>
                <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-300 transition-colors" aria-hidden="true" />
            </div>
            {loading || value == null ? (
                <span className="block h-8 w-16 bg-white/10 rounded animate-pulse" aria-hidden="true" />
            ) : (
                <span className="block text-3xl font-bold text-white leading-none">{value}</span>
            )}
            <span className="block mt-2 text-xs uppercase tracking-wider text-gray-400 font-semibold">{title}</span>
            {note && <span className="block mt-1 text-[11px] text-gray-500">{note}</span>}
        </Link>
    );
}

function MetricRow({
    events, userCount, pendingCount, messages,
}: {
    events: EventsSummary | null;
    userCount: number | null;
    pendingCount: number | null;
    messages: ContactMessage[] | null;
}) {
    const unresolvedCount = messages
        ? messages.filter((m) => !m.solved).length
        : null;
    const eventParts = (s: EventsSummary) =>
        [
            { label: "upcoming", n: s.upcoming },
            { label: "ongoing", n: s.ongoing },
            { label: "past", n: s.past },
        ]
            .filter((p) => p.n > 0)
            .map((p) => `${p.n} ${p.label}`)
            .join(" · ");

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Club summary">
            <MetricCard
                href="/admin/events"
                title="Events"
                icon={<CalendarCheck size={20} />}
                color="blue"
                loading={events === null}
                value={events?.total ?? null}
                note={events ? (eventParts(events) || "no events yet") : undefined}
            />
            <MetricCard
                href="/admin/students"
                title="Registered Students"
                icon={<Globe size={20} />}
                color="yellow"
                loading={userCount === null}
                value={userCount}
                note="site accounts"
            />
            <MetricCard
                href="/admin/admins"
                title="Access Requests"
                icon={<Inbox size={20} />}
                color={pendingCount && pendingCount > 0 ? "amber" : "blue"}
                loading={pendingCount === null}
                value={pendingCount}
                note={pendingCount && pendingCount > 0 ? "approvals needed" : "inbox clear"}
            />
            <MetricCard
                href="/admin/messages"
                title="Unanswered"
                icon={<MessageSquare size={20} />}
                color={unresolvedCount && unresolvedCount > 0 ? "amber" : "blue"}
                loading={messages === null}
                value={unresolvedCount}
                note={messages ? `${messages.filter((m) => m.solved).length} answered · ${messages.filter((m) => m.reminderAt != null && m.reminderAt.seconds * 1000 <= Date.now()).length} follow-ups due` : undefined}
            />
        </div>
    );
}

/* ── Action queue (replaces the static activity feed) ───────────────────── */

function ActionQueue({ items, ready }: { items: AttentionItem[]; ready: boolean }) {
    return (
        <section aria-labelledby="todo-heading" className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 id="todo-heading" className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-2">
                <ScanSearch size={16} className={items.length ? "text-amber-400" : "text-blue-400"} aria-hidden="true" />
                To Do Now
            </h2>

            {!ready ? (
                <div className="space-y-2.5" aria-label="Loading to-do list" role="status">
                    {[0, 1].map((i) => (
                        <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse" style={{ width: `${88 - i * 12}%` }} />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <p className="text-sm text-gray-500">
                    Nothing waiting on you. Attendance sessions, open feedback rounds and access
                    requests surface here the moment they appear.
                </p>
            ) : (
                <ul className="divide-y divide-white/5">
                    {items.map((item) => (
                        <li key={item.id}>
                            <Link
                                href={item.href}
                                className="group flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-400 outline-none"
                            >
                                <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                        item.kind === "attendance" ? "bg-blue-500" : item.kind === "feedback" ? "bg-purple-500" : "bg-amber-500"
                                    }`}
                                    aria-hidden="true"
                                />
                                <span className="text-sm text-gray-200 flex-1 min-w-0">{item.title}</span>
                                <ChevronRight size={16} className="text-gray-600 group-hover:text-white shrink-0 transition-colors" aria-hidden="true" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/* ── Upcoming events ────────────────────────────────────────────────────── */

function UpcomingEventsPanel({
    events, loading, hasError,
}: {
    events: Event[];
    loading: boolean;
    hasError: boolean;
}) {
    const eventsKey = useMemo(() => events.map((e) => e.id).join("|"), [events]);
    const [counts, setCounts] = useState<Record<string, number> | null>(null);

    useEffect(() => {
        const list = eventsKey ? eventsKey.split("|") : [];
        if (!list.length || hasError) return;
        let canceled = false;
        // Real registration totals for the visible events — the same aggregate
        // count queries the Forms page uses.
        getEventRegistrationCounts(list)
            .then((c) => { if (!canceled) setCounts(c); })
            .catch((err) => {
                if (canceled) return;
                console.warn("Registration counts unavailable:", err);
                setCounts({});
            });
        return () => { canceled = true; };
    }, [eventsKey, hasError]);

    return (
        <section aria-labelledby="upcoming-heading" className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 id="upcoming-heading" className="text-sm font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                    <CalendarCheck size={16} className="text-blue-400" aria-hidden="true" /> Upcoming &amp; Live
                </h2>
                <Link href="/admin/events" className="text-xs text-gray-400 hover:text-white transition-colors">
                    All events →
                </Link>
            </div>

            {hasError ? (
                <ErrorNote text="Event data could not load right now. Try refreshing — the rest of the dashboard is unaffected." />
            ) : loading ? (
                <div className="space-y-2.5" aria-label="Loading upcoming events" role="status">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-9 rounded-lg bg-white/5 animate-pulse" style={{ width: `${94 - i * 9}%` }} />
                    ))}
                </div>
            ) : events.length === 0 ? (
                <p className="text-sm text-gray-500">
                    No events on the horizon. Publish one and it will appear here with its live
                    registration count.
                </p>
            ) : (
                <ul className="divide-y divide-white/5">
                    {events.map((event) => (
                        <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                            <Link
                                href="/admin/forms"
                                className="group flex items-center gap-3 focus-visible:ring-2 focus-visible:ring-blue-400 outline-none rounded-lg"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-gray-100 truncate">{event.title}</span>
                                    <span className="block text-xs text-gray-500 mt-0.5">
                                        {formatEventDate(event.date)}
                                        {event.venue ? ` · ${event.venue}` : ""}
                                    </span>
                                </span>
                                {counts && counts[event.id] != null && (
                                    <span className="shrink-0 text-xs text-right" aria-label={`${counts[event.id]} registrations`}>
                                        <span className="font-semibold text-gray-200">{counts[event.id]}</span>
                                        <span className="text-gray-500"> reg’d</span>
                                    </span>
                                )}
                                <EventBadge event={event} />
                                <ChevronRight size={15} className="text-gray-600 group-hover:text-white shrink-0 transition-colors hidden sm:block" aria-hidden="true" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function formatEventDate(date: string): string {
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const REG_BADGES: Record<string, { label: string; cls: string }> = {
    open: { label: "Registration open", cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
    upcoming: { label: "Opens soon", cls: "bg-white/10 text-gray-300 border border-white/15" },
};

const ATTENDANCE_BADGE = { label: "Attendance live", cls: "bg-blue-500/20 text-blue-300 border border-blue-500/40" };

function EventBadge({ event }: { event: Event }) {
    if (event.attendanceStatus === "active" || event.status === "ongoing") {
        return <Badge data={ATTENDANCE_BADGE} />;
    }
    const badge = REG_BADGES[event.registrationStatus];
    if (!badge) return null;
    return <Badge data={badge} />;
}

function Badge({ data }: { data: { label: string; cls: string } }) {
    return (
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full whitespace-nowrap ${data.cls}`}>
            {data.label}
        </span>
    );
}

/* ── Engagement pulse ───────────────────────────────────────────────────── */

function EngagementPanel({ events, loading }: { events: Event[] | null; loading: boolean }) {
    const summary = events ? summarizeEvents(events) : null;
    return (
        <section aria-labelledby="pulse-heading" className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 id="pulse-heading" className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-2">
                <MessageSquare size={16} className="text-blue-400" aria-hidden="true" /> Engagement
            </h2>
            {loading || !summary ? (
                <div className="space-y-2.5" aria-label="Loading engagement stats" role="status">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse" style={{ width: `${88 - i * 8}%` }} />
                    ))}
                </div>
            ) : (
                <dl className="space-y-3">
                    <PanelStat label="Registration open" value={summary.registrationOpen} hint="events accepting sign-ups now" />
                    <PanelStat label="Feedback rounds open" value={summary.feedbackOpen} hint="events still collecting feedback" />
                    <PanelStat label="Average rating received" value={events ? avgFeedback(events) : 0} hint="across all rated events" star />
                </dl>
            )}
        </section>
    );
}

function avgFeedback(events: Event[]): number {
    const rated = events.filter((e) => typeof e.avgRating === "number" && (e.feedbackCount ?? 0) > 0);
    if (rated.length === 0) return 0;
    const weighted = rated.reduce((acc, e) => acc + (e.avgRating as number) * (e.feedbackCount || 0), 0);
    const totalFeedback = rated.reduce((acc, e) => acc + (e.feedbackCount || 0), 0);
    return totalFeedback === 0 ? 0 : Math.round((weighted / totalFeedback) * 10) / 10;
}

/* ── Learning library ───────────────────────────────────────────────────── */

function ResourcePanel() {
    const [resources, setResources] = useState<Resource[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let canceled = false;
        getResources()
            .then((r) => { if (!canceled) setResources(r); })
            .catch(() => { if (!canceled) { setFailed(true); setResources([]); } });
        return () => { canceled = true; };
    }, []);

    const byCategory = useMemo(() => {
        const counts = new Map<string, number>([["AIML", 0], ["DSA", 0], ["General", 0]]);
        for (const r of resources ?? []) {
            counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
        }
        return [...counts.entries()];
    }, [resources]);

    return (
        <section aria-labelledby="resources-heading" className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 id="resources-heading" className="text-sm font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                    <BookOpen size={16} className="text-blue-400" aria-hidden="true" /> Learning Library
                </h2>
                <Link href="/admin/resources" className="text-xs text-gray-400 hover:text-white transition-colors">
                    Manage →
                </Link>
            </div>
            {resources === null ? (
                <div className="grid grid-cols-3 gap-3" aria-label="Loading resource counts" role="status">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-4 h-[70px] animate-pulse" />
                    ))}
                </div>
            ) : failed ? (
                <ErrorNote text="Resource counts could not load right now." />
            ) : resources.length === 0 ? (
                <p className="text-sm text-gray-500">
                    No learning resources published yet. Add material from the Resources tab.
                </p>
            ) : (
                <dl className="grid grid-cols-3 gap-3 text-center">
                    {byCategory.map(([cat, n]) => (
                        <div key={cat} className="rounded-xl bg-white/5 border border-white/10 p-3">
                            <dt className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{cat}</dt>
                            <dd className="text-2xl font-bold text-white mt-1" aria-label={`${n} ${cat} resources`}>{n}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </section>
    );
}

/* ── Shared chrome ──────────────────────────────────────────────────────── */

function PanelStat({ label, value, hint, star }: { label: string; value: number; hint: string; star?: boolean }) {
    return (
        <div>
            <div className="flex items-baseline justify-between">
                <dt className="text-xs text-gray-400 font-semibold">{label}</dt>
                <dd className="text-lg font-bold text-white">
                    {value}
                    {star && value > 0 ? <span className="text-yellow-400 text-sm"> ★</span> : ""}
                </dd>
            </div>
            <p className="text-[11px] text-gray-500">{hint}</p>
        </div>
    );
}

function ErrorNote({ text }: { text: string }) {
    return (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200" role="alert">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{text}</span>
        </div>
    );
}

/* ── Inbox pulse ────────────────────────────────────────────────────────── */

function MessagesPanel({ messages }: { messages: ContactMessage[] | null }) {
    const now = Date.now();
    const summary = messages ? summarizeMessages(messages as unknown as MessageLike[], now) : null;
    const due = messages ? dueReminders(messages as unknown as MessageLike[], now) : [];

    return (
        <section aria-labelledby="inbox-heading" className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 id="inbox-heading" className="text-sm font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                    <Inbox size={16} className="text-blue-400" aria-hidden="true" /> Inbox Pulse
                </h2>
                <Link href="/admin/messages" className="text-xs text-gray-400 hover:text-white transition-colors">
                    Open Inbox →
                </Link>
            </div>

            {messages === null ? (
                <div className="space-y-2.5" aria-label="Loading inbox stats" role="status">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse" style={{ width: `${88 - i * 8}%` }} />
                    ))}
                </div>
            ) : !summary ? (
                <ErrorNote text="Inbox data could not load right now." />
            ) : (
                <>
                    <dl className="grid grid-cols-2 gap-3 text-center mb-4">
                        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                            <dt className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Unanswered</dt>
                            <dd className="text-2xl font-bold text-amber-400 mt-1" aria-label={`${summary.unsolved} unanswered messages`}>{summary.unsolved}</dd>
                        </div>
                        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                            <dt className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Answered</dt>
                            <dd className="text-2xl font-bold text-emerald-400 mt-1" aria-label={`${summary.solved} answered messages`}>{summary.solved}</dd>
                        </div>
                    </dl>

                    {due.length > 0 ? (
                        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
                            <div className="flex items-center gap-2 mb-2">
                                <Bell size={14} className="text-blue-400" aria-hidden="true" />
                                <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
                                    Follow-ups due ({due.length})
                                </span>
                            </div>
                            <ul className="space-y-1.5">
                                {due.slice(0, 4).map((m) => (
                                    <li key={m.id}>
                                        <Link
                                            href="/admin/messages"
                                            className="flex items-center gap-2 text-xs text-blue-200 hover:text-white transition-colors"
                                        >
                                            <span className="truncate">{m.subject}</span>
                                            <span className="text-[10px] text-blue-400 shrink-0">from {m.name}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : summary.unsolved === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-2">
                            All messages answered. No follow-ups due.
                        </p>
                    ) : (
                        <p className="text-sm text-gray-500 text-center py-2">
                            {summary.unsolved} unanswered · {summary.remindersUpcoming} follow-ups scheduled
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
