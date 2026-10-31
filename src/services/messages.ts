import { db } from "@/lib/firebase";
import { collection, addDoc, query, orderBy, Timestamp, onSnapshot, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { ContactMessage } from "@/types";

// --- Messages API ---

export async function saveMessage(data: Omit<ContactMessage, "id" | "timestamp">) {
    const docRef = await addDoc(collection(db, "messages"), {
        ...data,
        timestamp: Timestamp.now()
    });
    return docRef.id;
}

export function subscribeToMessages(callback: (messages: ContactMessage[]) => void) {
    const q = query(collection(db, "messages"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ContactMessage));
        callback(messages);
    });
}

/**
 * Marks a contact message solved (answered) or reopens it as unsolved.
 * This is the single admin write the inbox supports; Firestore rules only
 * allow updates that change the `solved` field.
 */
export async function setMessageSolved(id: string, solved: boolean) {
    await updateDoc(doc(db, "messages", id), {
        solved,
        solvedAt: solved ? Timestamp.now() : null,
    });
}

/**
 * Sets (or clears) a follow-up reminder on a contact message. Reminders are
 * optional admin-set timestamps; the dashboard surfaces messages whose
 * reminder has lapsed so nothing falls through the cracks.
 */
export async function setMessageReminder(id: string, reminderAt: Date | null) {
    await updateDoc(doc(db, "messages", id), {
        reminderAt: reminderAt ? Timestamp.fromDate(reminderAt) : null,
    });
}

export async function deleteMessage(id: string) {
    await deleteDoc(doc(db, "messages", id));
}

// --- Pure workflow helpers (no Firebase imports; node --test can exercise them) ---

export interface MessageSummary {
    total: number;
    solved: number;
    unsolved: number;
    remindersDue: number;
    remindersUpcoming: number;
}

/**
 * Aggregate the inbox into the workflow counts the dashboard and sidebar use.
 * `now` is passed in so tests are deterministic and the live UI can pass
 * `Date.now()` without depending on wall-clock timing.
 */
export function summarizeMessages(messages: ContactMessage[], now: number = Date.now()): MessageSummary {
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

export function unsolvedCount(messages: ContactMessage[]): number {
    return messages.filter((m) => !m.solved).length;
}

/** Messages whose follow-up reminder has already lapsed, newest first. */
export function dueReminders(messages: ContactMessage[], now: number = Date.now()): ContactMessage[] {
    return messages
        .filter((m) => m.reminderAt?.seconds != null && m.reminderAt.seconds * 1000 <= now)
        .sort((a, b) => (b.reminderAt.seconds - a.reminderAt.seconds));
}

/** Most recent unsolved messages, newest first, capped for the dashboard widget. */
export function recentUnsolved(messages: ContactMessage[], limit = 5): ContactMessage[] {
    return messages
        .filter((m) => !m.solved)
        .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))
        .slice(0, limit);
}