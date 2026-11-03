import { db } from "@/lib/firebase";
import { collection, doc, getDocs, query, where, getDoc } from "firebase/firestore";
import { getAuthHeaders } from "@/lib/authHeaders";
import { EventRegistration, Feedback } from "@/types";

// Student writes go through /api/registrations; Firestore rules block them from the client.
export async function callRegistrationsApi<T = { success: true }>(action: string, payload: Record<string, unknown>): Promise<T> {
    const authHeaders = await getAuthHeaders();
    if (!authHeaders) throw new Error("Please sign in again.");

    const res = await fetch("/api/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data as T;
}

// --- Registration API ---

export async function registerForEvent(eventId: string, teamName?: string) {
    const { registrationId } = await callRegistrationsApi<{ registrationId: string }>("register", { eventId, teamName });
    return registrationId;
}

export async function getEventRegistrations(eventId: string): Promise<EventRegistration[]> {
    try {
        const q = query(collection(db, "registrations"), where("eventId", "==", eventId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => doc.data() as EventRegistration);
    } catch (error) {
        console.warn("Error fetching event registrations:", error);
        return [];
    }
}

export async function checkRegistrationStatus(eventId: string, userId: string): Promise<EventRegistration | null> {
    // 1. Leader / individual registration
    const docSnap = await getDoc(doc(db, "registrations", `${eventId}_${userId}`));
    if (docSnap.exists()) {
        return docSnap.data() as EventRegistration;
    }

    // 2. Member of someone else's team
    const q = query(
        collection(db, "registrations"),
        where("eventId", "==", eventId),
        where("participantIds", "array-contains", userId)
    );

    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            return querySnapshot.docs[0].data() as EventRegistration;
        }
    } catch (e) {
        console.warn("Error checking member status:", e);
    }

    return null;
}

export async function submitFeedback(feedback: Pick<Feedback, "eventId" | "overallRating" | "matrixRatings" | "opinion">) {
    await callRegistrationsApi("feedback", feedback);
}

export async function checkinForEvent(eventId: string, code: string): Promise<void> {
    await callRegistrationsApi("checkin", { eventId, code });
}

export async function deleteTeam(eventId: string) {
    await callRegistrationsApi("deleteTeam", { eventId });
}

// Student: unregister themselves from an event.
export async function unregisterFromEvent(eventId: string) {
    await callRegistrationsApi("unregister", { eventId });
}

// Admin: remove any user's registration for an event.
export async function removeEventRegistration(eventId: string, targetUserId: string) {
    await callRegistrationsApi("removeRegistration", { eventId, targetUserId });
}

export async function removeTeamMember(eventId: string, leaderId: string, memberId: string) {
    await callRegistrationsApi("removeMember", { eventId, leaderId, memberId });
}
