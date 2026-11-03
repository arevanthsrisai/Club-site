import { db } from "@/lib/firebase";
import { collection, doc, getDocs, onSnapshot, query, setDoc, deleteDoc, where, writeBatch, getCountFromServer, type Firestore } from "firebase/firestore";
import { ClubRole, CTO_ROLE, DEFAULT_ROLE_ID, DEFAULT_ROLES, EX_CORE_ROLE, withBuiltIns } from "@/lib/roles";
import { logActivity } from "./audit";

// Helper to get the roles collection reference lazily (avoids module-scope
// initialization which would trigger Firestore SDK instanceof checks before
// the database ID is available during Next.js build-time page-data collection).
function rolesCollection(dbInstance: Firestore) {
    return collection(dbInstance, "club_roles");
}

export function subscribeToRoles(callback: (roles: ClubRole[]) => void) {
    return onSnapshot(rolesCollection(db), snap => {
        callback(withBuiltIns(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClubRole))));
    }, err => {
        console.warn("Error loading roles:", err);
        callback(withBuiltIns([]));
    });
}

// Stores the default roles. Called for the CTO while the collection is still empty.
export async function seedDefaultRoles() {
    const existing = await getDocs(rolesCollection(db));
    if (!existing.empty) return;
    const batch = writeBatch(db);
    DEFAULT_ROLES.forEach(({ id, ...role }) => batch.set(doc(rolesCollection(db), id), role));
    await batch.commit();
}

export async function saveRole(role: ClubRole, actorUid?: string, actorName?: string) {
    if (!role.id || !role.label.trim()) throw new Error("A role needs a name.");
    if (role.id === DEFAULT_ROLE_ID && role.limit !== null) throw new Error("Activator must stay unlimited.");
    // Ex-Core Member must never gain permissions: force the empty set no
    // matter what the caller sent (UI lock, API guard or corrupted payload).
    if (role.id === EX_CORE_ROLE.id) return saveRole({ ...role, permissions: [] }, actorUid, actorName);
    const { id, ...data } = role;
    // Build a clean payload: never write undefined fields (Firestore rejects
    // them), and only include fields that are actually present so a partial
    // update (e.g. reordering, which only changes `rank`) cannot wipe out
    // unrelated data such as permissions, description, or seat limits.
    const payload: Record<string, unknown> = {};
    if (data.label !== undefined) payload.label = data.label.trim();
    if (data.description !== undefined) payload.description = data.description;
    if (data.rank !== undefined) payload.rank = data.rank;
    if (data.limit !== undefined) payload.limit = data.limit;
    if (data.permissions !== undefined) payload.permissions = data.permissions;
    await setDoc(doc(rolesCollection(db), id), payload, { merge: true });
    if (actorUid) await logActivity(actorUid, actorName || "Unknown", "SAVE_ROLE", { role: id, ...payload });
}

export async function deleteRole(id: string, actorUid?: string, actorName?: string) {
    if (id === CTO_ROLE.id || id === DEFAULT_ROLE_ID || id === EX_CORE_ROLE.id) throw new Error("This role cannot be deleted.");
    const holders = await getCountFromServer(query(collection(db, "admins"), where("role", "==", id)));
    if (holders.data().count > 0) throw new Error("Move everyone out of this role before deleting it.");
    await deleteDoc(doc(rolesCollection(db), id));
    if (actorUid) await logActivity(actorUid, actorName || "Unknown", "DELETE_ROLE", { role: id });
}
