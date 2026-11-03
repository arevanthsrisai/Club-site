import { db } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, query, onSnapshot, setDoc, writeBatch, deleteField } from "firebase/firestore";
import { Event } from "@/types";
import { deleteFileByUrl } from "./storage";
import { getEventGallery, deleteFromGallery } from "./gallery";

// --- Events API ---

export async function getEvents(): Promise<Event[]> {
    try {
        const q = query(collection(db, "events")); // You might want to order by date here
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Event));
    } catch (error) {
        console.warn("Firebase fetch failed (Events):", error);
        return [];
    }
}

export function subscribeToEvents(callback: (events: Event[]) => void, onError?: (error: unknown) => void) {
    const q = query(collection(db, "events"));
    return onSnapshot(q, (snapshot) => {
        const events = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Event));
        callback(events);
    }, onError);
}

/**
 * Real registration counts, one aggregate count query per event (no documents
 * downloaded beyond metadata). Used by the events table and the Forms page.
 */
export async function getEventRegistrationCounts(eventIds: string[]): Promise<Record<string, number>> {
    const { collection, where, getCountFromServer } = await import("firebase/firestore");
    const out: Record<string, number> = {};
    await Promise.all(eventIds.map(async (id) => {
        try {
            const snap = await getCountFromServer(query(collection(db, "registrations"), where("eventId", "==", id)));
            out[id] = snap.data().count;
        } catch (e) {
            console.warn(`Registration count for ${id} unavailable:`, e);
        }
    }));
    return out;
}

export async function createEvent(event: Omit<Event, "id">) {
    // Use the new server API that creates the event with auto-generated forms
    const { getAuthHeaders } = await import("@/lib/authHeaders");
    const headers = await getAuthHeaders();
    if (!headers) throw new Error("Sign in required.");

    const res = await fetch("/api/admin/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ event }),
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(payload?.error || "Could not create the event.");
    }

    return payload.eventId;
}

export async function deleteEvent(id: string) {
    try {
        // 1. Fetch Event to get image URL
        const eventDocRef = doc(db, "events", id);
        const eventSnap = await getDoc(eventDocRef);

        if (!eventSnap.exists()) return;
        const eventData = eventSnap.data() as Event;

        // 2. Delete all Gallery items associated with this event
        // deleteFromGallery also removes each item's file from Storage
        const galleryImages = await getEventGallery(id);
        const galleryDeletePromises = galleryImages.map(img => deleteFromGallery(img.id));
        await Promise.all(galleryDeletePromises);

        // 3. Delete Event Cover Image (Firebase legacy + B2 via the keyed route)
        if (eventData.image) {
            await deleteFileByUrl(eventData.image);
            try {
                const { getAuthHeaders } = await import("@/lib/authHeaders");
                const headers = await getAuthHeaders();
                if (headers) {
                    await fetch("/api/admin/delete-b2", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...headers },
                        body: JSON.stringify({ url: eventData.image }),
                    });
                }
            } catch (e) {
                console.warn("Cover object cleanup skipped:", e);
            }
        }

        // 4. Delete Event Document
        await deleteDoc(eventDocRef);
    } catch (error) {
        console.error("Error deleting event:", error);
        throw error;
    }
}

export async function getEvent(id: string): Promise<Event | null> {
    try {
        const docRef = doc(db, "events", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as Event;
        }
        return null;
    } catch (error) {
        console.warn("Error fetching event:", error);
        return null;
    }
}

export async function updateEvent(id: string, data: Partial<Event>) {
    await updateDoc(doc(db, "events", id), data);
}

// --- Attendance ---
// Attendance sessions are tracked in `attendance_sessions/{sessionId}` with
// a `event_secrets/{eventId}` doc holding the active session id and code.
// Each session gets its own code; check-ins are recorded against the
// active session so history is preserved across restarts.

export async function startAttendance(eventId: string, code: string) {
    const sessionId = `${eventId}_${Date.now()}`;
    const now = Date.now();
    await setDoc(doc(db, "attendance_sessions", sessionId), {
        id: sessionId,
        eventId,
        code,
        startedAt: now,
        endedAt: null,
    });
    await setDoc(doc(db, "event_secrets", eventId), {
        code,
        sessionId,
        failures: {},
    });
    await updateDoc(doc(db, "events", eventId), {
        attendanceStatus: "active",
        attendanceSessionId: sessionId,
        attendanceCode: deleteField(),
    });
    return sessionId;
}

export async function stopAttendance(eventId: string) {
    const secretsSnap = await getDoc(doc(db, "event_secrets", eventId));
    if (!secretsSnap.exists()) {
        // No active session to stop; just mark event ended if not already.
        const evSnap = await getDoc(doc(db, "events", eventId));
        if (evSnap.exists() && evSnap.data()!.attendanceStatus !== "ended") {
            await updateDoc(doc(db, "events", eventId), { attendanceStatus: "ended" });
        }
        return;
    }
    const secrets = secretsSnap.data()!;
    const sessionId = secrets.sessionId;

    const batch = writeBatch(db);
    // End the active session
    if (sessionId) {
        batch.update(doc(db, "attendance_sessions", sessionId), { endedAt: Date.now() });
    }
    // Remove the active code so check-ins are blocked
    batch.delete(doc(db, "event_secrets", eventId));
    batch.update(doc(db, "events", eventId), { attendanceStatus: "ended", attendanceSessionId: null });
    await batch.commit();
}

export async function getAttendanceCode(eventId: string): Promise<{ code: string | null; sessionId: string | null }> {
    const snap = await getDoc(doc(db, "event_secrets", eventId));
    if (!snap.exists()) return { code: null, sessionId: null };
    const data = snap.data();
    return { code: data.code || null, sessionId: data.sessionId || null };
}

export function subscribeToEvent(id: string, callback: (event: Event | null) => void) {
    const docRef = doc(db, "events", id);
    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback({ id: docSnap.id, ...docSnap.data() } as Event);
        } else {
            callback(null);
        }
    });
}

import { Feedback } from "@/types";
import { where } from "firebase/firestore";

export async function getEventFeedbacks(eventId: string): Promise<Feedback[]> {
    try {
        const q = query(collection(db, "feedbacks"), where("eventId", "==", eventId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Feedback));
    } catch (error) {
        console.warn("Error fetching feedbacks:", error);
        return [];
    }
}
