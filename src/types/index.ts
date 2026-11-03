export interface Event {
    id: string;
    title: string;
    date: string;
    time?: string;
    venue?: string;
    description: string;
    fullDescription: string;
    details: string[];
    link?: string;
    image?: string;
    status: "upcoming" | "ongoing" | "past"; // Display status
    registrationStatus: "upcoming" | "open" | "closed"; // Logic status
    isFeedbackOpen: boolean;
    attendanceStatus?: 'upcoming' | 'active' | 'ended'; // Lifecycle
    attendanceSessionId?: string; // Active attendance session id
    feedbackStatus?: 'upcoming' | 'active' | 'ended'; // Lifecycle
    avgRating?: number;
    feedbackCount?: number;
    minTeamSize?: number; // Default 1
    maxTeamSize?: number; // Default 1
    maxParticipants?: number; // Max total participants across all teams/individuals (waitlist when reached)
    enableWaitlist?: boolean; // Allow waitlisted registrations above maxParticipants
}

export type ResourceCategory = "AIML" | "DSA" | "General";

export interface Resource {
    id: string;
    title: string;
    description: string;
    category: ResourceCategory;
    type: "image" | "pdf" | "url";
    url: string; // The content URL (File or Link)
    thumbnailUrl?: string; // Required for 'url' type, optional for others
}


export interface GalleryImage {
    id: string;
    src: string;
    alt: string;
    eventId?: string;
    type?: 'image' | 'video'; // optional for backward compatibility, default 'image'
    category?: string;
    timestamp: any;
    storageKey?: string; // object key in the S3-compatible store (gallery/<eventId>/...); absent for legacy Firebase Storage items
    storedSize?: number; // bytes stored after lossless optimization
    storedLosslessly?: boolean; // true when a lossless WebP re-encode shrank the original
    thumbnailKey?: string; // poster image key for videos (gallery/<eventId>/...-thumb.jpg)
    originalKey?: string; // preserved pre-processing original for videos (recovery / reprocessing)
    processingStatus?: "done" | "partial" | "unprocessed"; // honest video-pipeline status; absent = "done"
    processingError?: string;
}

export interface AdminProfile {
    uid: string;
    email: string;
    role: string; // "pending" until approved; otherwise a club_roles id or "CTO"
    status: "onboarding" | "active";
    createdAt: any;
    approvedAt?: any;
    displayName?: string;
    photoURL?: string | null;
    rollNo?: string;
    dob?: string;
    /** Searchable display helper; never used for sign-in or authorization. */
    nickname?: string;
    socials?: {
        linkedin?: string;
        instagram?: string;
        github?: string;
    };
    /** Set when this admin was moved into Ex-Core (their team tenure ended);
     *  the About page and the admin team list exclude them from that moment. */
    exCoreAt?: any;
}

export interface PendingRegistration {
    id: string;
    email: string;
    requestedAt: any;
}

export interface AuditLog {
    id: string;
    actorUid: string;
    actorName: string;
    action: string;
    details?: any;
    timestamp: any; // Firestore Timestamp
}

export interface UserProfile {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    rollNo?: string;
    class?: string; // e.g. "AIE", "CSE" - Configurable
    section?: string; // e.g. "A", "B" - Configurable
    hosteller?: boolean;
    mobile?: string;
    dob?: string; // "YYYY-MM-DD" — optional, used for birthday wishes
    isVerified: boolean;
    createdAt: any;
}

export interface EventRegistration {
    id: string;
    eventId: string;
    userId: string;
    userDetails: {
        name: string;
        rollNo: string;
        class: string;
        section: string;
        mobile: string;
    };
    registeredAt: any;
    status: 'forming' | 'registered' | 'cancelled' | 'attended' | 'waitlisted';
    feedbackSubmitted?: boolean;
    teamName?: string;
    teamMembers?: {
        name: string;
        rollNo: string;
        userId?: string;
    }[];
    participantIds?: string[]; // Includes leader and all members for query efficiency
    pendingRequests?: string[]; // User IDs of students requesting to join
    attendance?: { [userId: string]: boolean };
    feedbackMap?: { [userId: string]: boolean };
}

export interface TeamInvitation {
    id: string; // eventId_targetUserId
    eventId: string;
    eventTitle: string;
    teamName: string;
    registrationId: string; // eventId_senderUserId
    senderId: string;
    senderName: string;
    targetUserId: string;
    targetName: string;
    targetRollNo: string;
    type: 'invite' | 'request'; // Distinguish between team invites and join requests
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: any;
    respondedAt?: any;
}

// Public fields returned by the student search on /api/registrations.
export type StudentSearchResult = Pick<UserProfile, "uid" | "displayName" | "rollNo" | "photoURL">;

export interface AvailableTeam {
    id: string; // registration id
    teamName: string;
    leaderName: string;
    memberCount: number;
}

export interface Feedback {
    id: string;
    eventId: string;
    registrationId?: string; // Link to specific registration doc (important for teams)
    userId: string;
    userName: string;
    overallRating: number; // 5 stars
    matrixRatings: {
        content: number;
        activities: number;
        interaction: number;
        organization: number;
        enjoyment: number;
        knowledgeable: number;
    };
    opinion: string;
    submittedAt: any;
}

export interface ContactMessage {
    id: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    timestamp: any;
    /** Workflow flag set by admins from the Inbox; absent = not yet answered. */
    solved?: boolean;
    /** When the admin marked it solved; used to show "answered X ago". */
    solvedAt?: any;
    /** Optional admin-set follow-up reminder. The dashboard surfaces messages
     *  whose reminder has lapsed so nothing falls through the cracks. */
    reminderAt?: any;
}

export interface MessageReminder {
    id: string;
    subject: string;
    name: string;
    email: string;
    reminderAt: any; // Firestore Timestamp
    timestamp: any;
}

export interface Alumni {
    id: string;
    name: string;
    batchYear: string;         // e.g. "2020-2024"
    roleHeld: string;          // Role they held in ReLU, e.g. "President"
    currentPosition?: string;  // e.g. "Software Engineer"
    company?: string;          // e.g. "Google"
    linkedinUrl?: string;
    photoURL?: string;
    createdAt: any;
}
