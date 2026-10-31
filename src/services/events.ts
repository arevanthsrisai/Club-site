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
    const docRef = await addDoc(collection(db, "events"), event);
    return docRef.id;
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
// The code lives in admin-only 'event_secrets/{eventId}'; the public event doc only says whether attendance is open.
// deleteField() also clears codes left on event docs by older versions.

export async function startAttendance(eventId: string, code: string) {
    await setDoc(doc(db, "event_secrets", eventId), { code, failures: {} });
    await updateDoc(doc(db, "events", eventId), { attendanceStatus: "active", attendanceCode: deleteField() });
}

export async function stopAttendance(eventId: string) {
    const batch = writeBatch(db);
    batch.delete(doc(db, "event_secrets", eventId));
    batch.update(doc(db, "events", eventId), { attendanceStatus: "ended", attendanceCode: deleteField() });
    await batch.commit();
}

export async function getAttendanceCode(eventId: string): Promise<string | null> {
    const snap = await getDoc(doc(db, "event_secrets", eventId));
    return snap.exists() ? snap.data().code : null;
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
