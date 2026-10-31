import { db } from "@/lib/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { normalizeEmail } from "@/lib/normalizeEmail";

/**
 * Race-safe duplicate guard for account creation.
 *
 * Firebase Auth's `email-already-in-use` is case-insensitive, but our own
 * Firestore lookups are not. This checks every collection that holds an
 * account record using the *normalized* email, so `Admin@Example.com` and
 * `admin@example.com` can never both exist.
 *
 * Call this on the server before any `createUserWithEmailAndPassword` /
 * `createAdminDirectly` / `createPendingRegistration` so a duplicate is
 * rejected before Auth state is mutated.
 */
export async function assertEmailNotInUse(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error("Email is required.");

    const collections = ["admins", "users", "pending_registrations"];
    for (const col of collections) {
        const q = query(collection(db, col), where("email", "==", normalized));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const err = new Error("Email is already registered.");
            (err as any).code = "email-already-in-use";
            throw err;
        }
    }
}