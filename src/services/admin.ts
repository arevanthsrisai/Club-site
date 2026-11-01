import { db } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, query, orderBy, where, onSnapshot, runTransaction, Timestamp, getCountFromServer } from "firebase/firestore";
import { AdminProfile, PendingRegistration } from "@/types";
import { logActivity } from "./audit";
import { deleteUserData } from "./users";
import { isPasswordStrong } from "@/lib/schemas";
import { ClubRole, CTO_ROLE, DEFAULT_ROLE_ID, DEFAULT_ROLES } from "@/lib/roles";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { assertEmailNotInUse } from "@/services/emails";

function normalizeIncomingEmail(email: string): string {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error("Email is required.");
    return normalized;
}

// --- Constants ---
const TENURE_DURATION_MS = 2 * 365 * 24 * 60 * 60 * 1000; // 2 Years

// --- Helpers ---

async function checkRoleLimit(role: string): Promise<boolean> {
    let limit: number | null;
    if (role === CTO_ROLE.id) {
        limit = CTO_ROLE.limit;
    } else {
        const snap = await getDoc(doc(db, "club_roles", role));
        const def = snap.exists() ? snap.data() as ClubRole : DEFAULT_ROLES.find(r => r.id === role);
        if (!def) throw new Error(`Unknown role: ${role}`);
        limit = def.limit;
    }
    if (limit === null) return true;

    const q = query(collection(db, "admins"), where("role", "==", role), where("status", "==", "active"));
    const snapshot = await getCountFromServer(q);

    return snapshot.data().count < limit;
}

export async function checkTenure(admin: AdminProfile) {
    if (admin.role === "CTO") return false; // CTO is immune to tenure expiry

    const startDate = admin.approvedAt || admin.createdAt;
    if (!startDate) return;

    const start = startDate.toDate().getTime();
    const now = Date.now();

    if (now - start > TENURE_DURATION_MS) {
        console.warn(`Tenure expired for ${admin.email}. Deleting account.`);
        await deleteUserData(admin.uid);
        await logActivity("SYSTEM", "System", "TENURE_EXPIRED", { targetUid: admin.uid, email: admin.email });
        // Force logout is handled by Auth listener detecting user deletion
        return true; // Deleted
    }
    return false; // Active
}

// --- Admin Management API (RBAC) ---

export async function createAdminProfile(uid: string, email: string) {
    const normalized = normalizeEmail(email) ?? email;
    await setDoc(doc(db, "admins", uid), {
        uid,
        email: normalized,
        role: "pending",
        createdAt: Timestamp.now()
    });
}

export async function getAdminProfile(uid: string): Promise<AdminProfile | null> {
    try {
        const docRef = doc(db, "admins", uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data() as AdminProfile;
        }
        return null;
    } catch (error) {
        console.warn("Error fetching admin profile:", error);
        return null;
    }
}

export async function getAllAdmins(): Promise<AdminProfile[]> {
    try {
        const q = query(collection(db, "admins"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map((doc) => doc.data() as AdminProfile);
    } catch (error) {
        console.warn("Error fetching all admins:", error);
        return [];
    }
}

export function subscribeToAllAdmins(callback: (admins: AdminProfile[]) => void) {
    const q = query(collection(db, "admins"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
        const admins = snapshot.docs.map((doc) => doc.data() as AdminProfile);
        callback(admins);
    });
}

export async function isSystemInitialized(): Promise<boolean> {
    try {
        const snapshot = await getCountFromServer(collection(db, "admins"));
        return snapshot.data().count > 0;
    } catch (error) {
        // Fail closed: only admins can list admins, so an error must never make the caller the first CTO.
        console.warn("Error checking system initialization:", error);
        return true;
    }
}

export async function updateAdminRole(uid: string, role: string, actorUid?: string, actorName?: string) {
    // 1. Check Limit
    if (!(await checkRoleLimit(role))) {
        throw new Error(`Role limit reached for ${role}. Cannot assign.`);
    }

    await updateDoc(doc(db, "admins", uid), { role });

    if (actorUid) {
        await logActivity(actorUid, actorName || "Unknown", "UPDATE_ROLE", { targetUid: uid, newRole: role });
    }
}

// Gives a full role to targetUid and moves its current holder back to the default role, in one step.
export async function replaceRoleHolder(targetUid: string, replacedUid: string, role: string, actorUid?: string, actorName?: string) {
    if (role === CTO_ROLE.id) throw new Error("Use the Doomsday console to hand over the CTO role.");
    await runTransaction(db, async (transaction) => {
        const replacedRef = doc(db, "admins", replacedUid);
        const replaced = await transaction.get(replacedRef);
        if (replaced.data()?.role !== role) throw new Error("That member no longer holds this role. Refresh and try again.");
        transaction.update(replacedRef, { role: DEFAULT_ROLE_ID });
        transaction.update(doc(db, "admins", targetUid), { role });
    });
    if (actorUid) {
        await logActivity(actorUid, actorName || "Unknown", "REPLACE_ROLE", { role, targetUid, replacedUid });
    }
}

export async function updateAdminProfileData(uid: string, data: Partial<AdminProfile>) {
    await updateDoc(doc(db, "admins", uid), data);
}

export async function deleteAdmin(uid: string) {
    const headers = await getAuthHeaders();
    if (!headers) throw new Error("Sign in again.");

    const res = await fetch(`/api/admin/delete-admin?uid=${encodeURIComponent(uid)}`, {
        method: "DELETE",
        headers: { ...headers },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Revoke failed (${res.status}).`);
    }
}

// --- Doomsday (CTO Transfer) ---
export async function transferCTORole(currentCTOUid: string, targetEmail: string) {
    // This requires a transaction to be safe
    // 1. Find target user by email (normalized so case differences never miss)
    const normalizedTarget = normalizeEmail(targetEmail) ?? targetEmail;
    const adminsRef = collection(db, "admins");
    const q = query(adminsRef, where("email", "==", normalizedTarget));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        throw new Error("Target admin not found");
    }

    const targetAdmin = querySnapshot.docs[0];
    const targetUid = targetAdmin.id;

    if (targetUid === currentCTOUid) {
        throw new Error("You cannot transfer role to yourself");
    }

    await runTransaction(db, async (transaction) => {
        // 2. Double check current user is still CTO (security)
        const currentAdminRef = doc(db, "admins", currentCTOUid);
        const currentAdminSnap = await transaction.get(currentAdminRef);
        if (currentAdminSnap.data()?.role !== "CTO") {
            throw new Error("You are not authorized to perform this action");
        }

        // 3. Update roles
        transaction.update(currentAdminRef, { role: "Mentor" }); // Old CTO becomes Mentor
        transaction.update(doc(db, "admins", targetUid), { role: "CTO" }); // New CTO
    });
}

// --- Pending Registrations (The "Dummy Table") ---

export async function createPendingRegistration(uid: string, email: string) {
    const normalized = normalizeIncomingEmail(email);
    // We use the UID as the document ID so we can easily link it to the Auth user
    await setDoc(doc(db, "pending_registrations", uid), {
        email: normalized,
        requestedAt: Timestamp.now()
    });
}

export async function getPendingRegistrations(): Promise<PendingRegistration[]> {
    try {
        const q = query(collection(db, "pending_registrations"));
        const querySnapshot = await getDocs(q);
        const regs = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as PendingRegistration));
        regs.sort((a, b) => { // Client side sort
            return (b.requestedAt?.seconds || 0) - (a.requestedAt?.seconds || 0);
        });
        return regs;
    } catch (error) {
        console.warn("Error fetching pending registrations:", error);
        return [];
    }
}

export function subscribeToPendingRegistrations(callback: (regs: PendingRegistration[]) => void) {
    const q = query(collection(db, "pending_registrations"));
    return onSnapshot(q, (snapshot) => {
        const regs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as PendingRegistration));
        // Client-side sort
        regs.sort((a, b) => {
            const tA = a.requestedAt?.seconds || 0;
            const tB = b.requestedAt?.seconds || 0;
            return tB - tA;
        });
        callback(regs);
    });
}

export async function approveRegistration(uid: string, actorUid?: string, actorName?: string) {
    let email = "";
    let createdAt = Timestamp.now();

    // 1. Try to get from pending_registrations
    const pendingRef = doc(db, "pending_registrations", uid);
    const pendingSnap = await getDoc(pendingRef);

    if (pendingSnap.exists()) {
        const data = pendingSnap.data();
        email = normalizeIncomingEmail(data.email);
        createdAt = data.requestedAt;
        // Delete from pending
        await deleteDoc(pendingRef);
    } else {
        // 2. Fallback: Check if user exists in 'admins' with role 'pending'
        const adminRef = doc(db, "admins", uid);
        const adminSnap = await getDoc(adminRef);

        if (adminSnap.exists() && adminSnap.data().role === "pending") {
            const data = adminSnap.data();
            email = normalizeIncomingEmail(data.email);
            createdAt = data.createdAt;
        } else {
            throw new Error("Registration request not found");
        }
    }

    // 3. Create/Update Admin Profile with 'onboarding' status
    // Default role is 'Activator' (No limit)
    // We use setDoc with merge: true to avoid overwriting existing fields if falling back
    await setDoc(doc(db, "admins", uid), {
        uid,
        email,
        role: "Activator",
        status: "onboarding", // Forces user to fill profile
        createdAt: createdAt, // Maintain original request time
        approvedAt: Timestamp.now() // Tenure Starts Now
    }, { merge: true });

    if (actorUid) {
        await logActivity(actorUid, actorName || "Unknown", "APPROVE_ADMIN", { targetUid: uid, email });
    }
}

export async function rejectRegistration(uid: string, actorUid?: string, actorName?: string) {
    // 1. Perform Full Data Wipe (Pending + User + Admin + Data)
    await deleteUserData(uid);

    // 2. Log Audit
    if (actorUid) {
        await logActivity(actorUid, actorName || "Unknown", "REJECT_ADMIN", { targetUid: uid });
    }
}

// --- Data Purge ---

import { writeBatch } from "firebase/firestore";

export async function purgeEventData(eventId: string) {
    // 1. Delete Registrations
    const regsQuery = query(collection(db, "registrations"), where("eventId", "==", eventId));
    const regsSnap = await getDocs(regsQuery);

    // 2. Delete Feedbacks
    const feedQuery = query(collection(db, "feedbacks"), where("eventId", "==", eventId));
    const feedSnap = await getDocs(feedQuery);

    const batch = writeBatch(db);

    regsSnap.docs.forEach((d) => batch.delete(d.ref));
    feedSnap.docs.forEach((d) => batch.delete(d.ref));

    await batch.commit();
}

// --- Direct User Creation (server-side via Firebase Admin SDK) ---
import { getAuthHeaders } from "@/lib/authHeaders";

export async function createAdminDirectly(email: string, pass: string, role: string, actorUid?: string, actorName?: string) {
    const normalized = normalizeIncomingEmail(email);
    if (!isPasswordStrong(pass)) {
        throw new Error("Password must be at least 8 characters with uppercase, lowercase, a number and a special character.");
    }

    // 0. Check Role Limit First (client-side pre-check; server re-verifies CTO)
    if (!(await checkRoleLimit(role))) {
        throw new Error(`Role limit reached for ${role}. Cannot create.`);
    }

    const headers = await getAuthHeaders();
    if (!headers) throw new Error("Sign in again.");

    const res = await fetch("/api/admin/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ email: normalized, password: pass, role }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Create failed (${res.status}).`);
    }
    return json.uid as string;
}

