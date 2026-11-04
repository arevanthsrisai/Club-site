import { db } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs, addDoc, deleteDoc, query, Timestamp, where, onSnapshot } from "firebase/firestore";
import { GalleryImage } from "@/types";
import { deleteFileByUrl } from "./storage";

// --- Gallery API ---

export async function getEventGallery(eventId: string): Promise<GalleryImage[]> {
    try {
        const q = query(
            collection(db, "gallery"),
            where("eventId", "==", eventId)
            // Note: Add compound index in firebase if sorting by timestamp is needed
        );
        const querySnapshot = await getDocs(q);
        const docs = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as GalleryImage));
        return docs.sort((a, b) => b.timestamp - a.timestamp); // Manual sort if index missing
    } catch (error) {
        console.warn("Firebase fetch failed (Event Gallery):", error);
        return [];
    }
}

export async function addToGallery(image: Omit<GalleryImage, "id" | "timestamp">) {
    const docRef = await addDoc(collection(db, "gallery"), {
        ...image,
        timestamp: Timestamp.now()
    });
    return docRef.id;
}

export async function deleteFromGallery(id: string) {
    try {
        const docRef = doc(db, "gallery", id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data() as GalleryImage;
            if (data.storageKey) {
                // Stored objects are removed by the server route that holds the
                // storage credentials; it validates admin identity and the key.
                // Videos also carry a poster thumbnail and a preserved original
                // — both are cleaned up in the same call when present.
                const { getAuthHeaders } = await import("@/lib/authHeaders");
                const headers = await getAuthHeaders();
                if (headers) {
                    const res = await fetch("/api/gallery/delete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...headers },
                        body: JSON.stringify({
                            key: data.storageKey,
                            ...(data.thumbnailKey ? { thumbnailKey: data.thumbnailKey } : {}),
                            ...(data.originalKey ? { originalKey: data.originalKey } : {}),
                        }),
                    });
                    if (!res.ok) throw new Error(`Stored file delete failed (${res.status})`);
                }
            } else {
                // Legacy items live in Firebase Storage.
                await deleteFileByUrl(data.src);
            }
        }

        await deleteDoc(docRef);
    } catch (error) {
        console.error("Error deleting gallery item:", error);
        throw error;
    }
}

export function subscribeToEventGallery(eventId: string, callback: (images: GalleryImage[]) => void) {
    const q = query(collection(db, "gallery"), where("eventId", "==", eventId));
    return onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as GalleryImage));
        docs.sort((a, b) => b.timestamp - a.timestamp);
        callback(docs);
    });
}
