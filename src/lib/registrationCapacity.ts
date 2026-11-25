/**
 * Capacity accounting for event registrations.
 *
 * A waitlisted registration is a request for a future place, not an occupied
 * one. Counting waitlisted rows as participants permanently shrinks the event
 * (a freed slot can never be offered to the waitlist), so only registrations
 * that actually hold a place count toward `maxParticipants`.
 */
export interface RegistrationCapacityLike {
    status?: string;
    participantIds?: string[];
}

export function countActiveParticipants(
    registrations: readonly RegistrationCapacityLike[],
): number {
    let total = 0;
    for (const registration of registrations) {
        if (registration.status === "waitlisted") continue;
        const participants = Array.isArray(registration.participantIds)
            ? registration.participantIds.length
            : 0;
        // Legacy individual registrations may lack participantIds.
        total += participants || 1;
    }
    return total;
}
