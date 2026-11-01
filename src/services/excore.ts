import { db } from "@/lib/firebase";
import {
    collection, doc, getDocs, onSnapshot, query, where, getDoc
} from "firebase/firestore";
import type { ExCoreMember } from "@/lib/excore";

/**
 * Client-side Firestore reads for ex_core_members.
 *
 * Every mutation goes through the secured server API routes
 * (/api/ex-core/*), which authenticate the caller's Firebase ID token and
 * enforce ownership and privilege server-side via serverAuthz — the client
 * SDK never writes Ex-Core profiles directly.
 */

export async function getExCoreMembers(): Promise<ExCoreMember[]> {
    const snap = await getDocs(collection(db, "ex_core_members"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ExCoreMember));
}

export function subscribeToExCoreMembers(callback: (members: ExCoreMember[]) => void) {
    return onSnapshot(collection(db, "ex_core_members"), (snapshot) => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ExCoreMember)));
    });
}

/** The Ex-Core profile linked to a given admin account id, if any. */
export async function getLinkedExCoreMember(userId: string): Promise<ExCoreMember | null> {
    const snap = await getDocs(query(collection(db, "ex_core_members"), where("linkedUserId", "==", userId)));
    return snap.docs.length ? ({ id: snap.docs[0].id, ...snap.docs[0].data() } as ExCoreMember) : null;
}

export async function getExCoreMemberById(id: string): Promise<ExCoreMember | null> {
    const snap = await getDoc(doc(db, "ex_core_members", id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as ExCoreMember) : null;
}
