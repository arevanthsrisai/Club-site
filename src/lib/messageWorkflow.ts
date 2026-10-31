/**
 * Pure contact-message workflow helpers.
 *
 * No Firebase imports here so `node --test` can exercise these functions
 * directly. The inbox is a thin render layer over these, so covering them
 * here covers the solved/reminder math without needing Firestore.
 */

// Minimal shape these helpers need. The full ContactMessage type lives in
// @/types and is wired in by the app; tests can pass plain objects.
export interface MessageLike {
    id: string;
    name?: string;
    subject?: string;
    solved?: boolean;
    timestamp?: { seconds?: number };
    reminderAt?: { seconds?: number };
}

export interface MessageSummary {
    total: number;
    solved: number;
    unsolved: number;
    remindersDue: number;
    remindersUpcoming: number;
}

/** Aggregate the inbox into the workflow counts the dashboard and sidebar use. */
export function summarizeMessages(
    messages: MessageLike[],
    now: number = Date.now()
): MessageSummary {
    let solved = 0;
    let remindersDue = 0;
    let remindersUpcoming = 0;
    for (const m of messages) {
        if (m.solved) solved++;
        if (m.reminderAt?.seconds == null) continue;
        const at = m.reminderAt.seconds * 1000;
        if (at <= now) remindersDue++;
        else remindersUpcoming++;
    }
    return {
        total: messages.length,
        solved,
        unsolved: messages.length - solved,
        remindersDue,
        remindersUpcoming,
    };
}

export function unsolvedCount(messages: MessageLike[]): number {
    return messages.filter((m) => !m.solved).length;
}

/** Messages whose follow-up reminder has already lapsed, newest first. */
export function dueReminders(
    messages: MessageLike[],
    now: number = Date.now()
): MessageLike[] {
    return messages
        .filter(
            (m) =>
                m.reminderAt?.seconds != null &&
                m.reminderAt.seconds * 1000 <= now
        )
        .sort((a, b) => {
            const aSec = a.reminderAt?.seconds ?? 0;
            const bSec = b.reminderAt?.seconds ?? 0;
            return bSec - aSec;
        });
}

/** Most recent unsolved messages, newest first, capped for the dashboard widget. */
export function recentUnsolved(
    messages: MessageLike[],
    limit = 5
): MessageLike[] {
    return messages
        .filter((m) => !m.solved)
        .sort(
            (a, b) =>
                (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0)
        )
        .slice(0, limit);
}