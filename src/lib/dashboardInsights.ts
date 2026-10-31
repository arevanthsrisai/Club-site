/**
 * Pure derivation logic for the admin dashboard. No Firebase imports here so
 * node --test can exercise these functions directly; every function takes
 * already-loaded data and returns facts about it, nothing more.
 */

export interface DashboardEventLike {
    id: string;
    title: string;
    date: string;
    status?: "upcoming" | "ongoing" | "past";
    registrationStatus?: "upcoming" | "open" | "closed";
    isFeedbackOpen?: boolean;
    attendanceStatus?: "upcoming" | "active" | "ended";
    venue?: string;
}

export interface EventsSummary {
    total: number;
    upcoming: number;
    ongoing: number;
    past: number;
    registrationOpen: number;
    attendanceActive: number;
    feedbackOpen: number;
}

/** One row per actionable state in the "needs attention" queue. */
export interface AttentionItem {
    kind: "attendance" | "feedback" | "approval";
    /** Stable React key. */
    id: string;
    title: string;
    /** Where the item is resolved, e.g. "/admin/forms" or "/admin/admins". */
    href: string;
}

/** Aggregate the event list into the dashboard's top-line counts. */
export function summarizeEvents(events: DashboardEventLike[]): EventsSummary {
    const summary: EventsSummary = {
        total: events.length,
        upcoming: 0,
        ongoing: 0,
        past: 0,
        registrationOpen: 0,
        attendanceActive: 0,
        feedbackOpen: 0,
    };
    for (const event of events) {
        if (event.status === "upcoming") summary.upcoming++;
        else if (event.status === "ongoing") summary.ongoing++;
        else if (event.status === "past") summary.past++;
        if (event.registrationStatus === "open") summary.registrationOpen++;
        if (event.attendanceStatus === "active") summary.attendanceActive++;
        if (event.isFeedbackOpen) summary.feedbackOpen++;
    }
    return summary;
}

/** Parsed event date; null when the stored free-text date cannot be parsed. */
function parseEventDate(event: DashboardEventLike): Date | null {
    if (!event.date?.trim()) return null;
    const d = new Date(event.date.trim());
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Events still ahead today (venue night of inclusive), soonest first, capped.
 * Events whose date cannot be parsed are skipped rather than guessed.
 */
export function upcomingEvents<T extends DashboardEventLike>(
    events: T[],
    now: Date = new Date(),
    limit = 5
): T[] {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return events
        .map((event) => ({ event, time: parseEventDate(event)?.getTime() ?? NaN }))
        .filter(({ time }) => Number.isFinite(time) && time >= startOfToday)
        .sort((a, b) => a.time - b.time)
        .slice(0, limit)
        .map(({ event }) => event);
}

/**
 * The administrative action queue, derived only from states the data actually
 * carries: live attendance sessions, events collecting feedback, and accounts
 * awaiting approval. Each item resolves on the page that fixes it.
 */
export function attentionItems(
    events: DashboardEventLike[],
    // PendingRegistration documents keyed by their uid (= Firestore doc id).
    pendingApprovals: { uid: string; email?: string }[]
): AttentionItem[] {
    const items: AttentionItem[] = [];
    for (const event of events) {
        if (event.attendanceStatus === "active") {
            items.push({
                kind: "attendance",
                id: `attendance-${event.id}`,
                title: `Attendance is live for “${event.title}” — check in students from the Forms tab`,
                href: "/admin/forms",
            });
        }
        if (event.isFeedbackOpen) {
            items.push({
                kind: "feedback",
                id: `feedback-${event.id}`,
                title: `Feedback collection is open for “${event.title}”`,
                href: "/admin/forms",
            });
        }
    }
    for (const pending of pendingApprovals) {
        items.push({
            kind: "approval",
            id: `approval-${pending.uid}`,
            title: `Access request from ${pending.email || "a new admin"} is awaiting approval`,
            href: "/admin/admins",
        });
    }
    return items;
}

