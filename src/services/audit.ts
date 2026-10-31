import { db } from "@/lib/firebase";
import { addDoc, collection, query, orderBy, onSnapshot, limit, where, getDocs, writeBatch, Timestamp, getCountFromServer } from "firebase/firestore";
import { AuditLog } from "@/types";

// Retention Policy: keep the latest logs. The Activity Log page gives admins
// searchable history, so the old 30-record scissors rule is raised — enough
// history to diagnose admin operations without ever risking unbounded growth.
export const AUDIT_RETENTION_RECORDS = 500;

export async function logActivity(actorUid: string, actorName: string, action: string, details: any = {}) {
    try {
        await addDoc(collection(db, "audit_logs"), {
            action,
            actorUid,
            actorName,
            details,
            timestamp: Timestamp.now()
        });

        // Use count query first to avoid fetching all documents on every write
        const countSnap = await getCountFromServer(collection(db, "audit_logs"));
        if (countSnap.data().count > AUDIT_RETENTION_RECORDS) {
            const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"));
            const snapshot = await getDocs(q);

            if (snapshot.size > AUDIT_RETENTION_RECORDS) {
                const batch = writeBatch(db);
                const docsToDelete = snapshot.docs.slice(AUDIT_RETENTION_RECORDS);
                docsToDelete.forEach((doc) => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
            }
        }

    } catch (e) {
        console.error("Failed to log audit action", e);
    }
}

export function subscribeToActivity(callback: (logs: AuditLog[]) => void) {
    const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(50));
    return onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as AuditLog));
        callback(logs);
    });
}

export async function archiveOldLogs(days: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    const q = query(collection(db, "audit_logs"), where("timestamp", "<", cutoffTimestamp));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return 0;

    const chunks = [];
    for (let i = 0; i < snapshot.docs.length; i += 500) {
        chunks.push(snapshot.docs.slice(i, i + 500));
    }

    for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    return snapshot.size;
}
