import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, getDocs } from "firebase/firestore";
import { StoredImage } from "@/types";

/** Firestore reads for the admin Image Stash index (writes are server-only). */

const COLLECTION = "image_assets";

export function subscribeToImageAssets(
    callback: (assets: StoredImage[]) => void,
    onError?: (error: Error) => void,
) {
    const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    return onSnapshot(
        q,
        (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as StoredImage[]);
        },
        (error) => {
            console.error("Image Stash subscription failed:", error);
            onError?.(error);
        },
    );
}

export async function getImageAssets(): Promise<StoredImage[]> {
    const snapshot = await getDocs(query(collection(db, COLLECTION), orderBy("createdAt", "desc")));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as StoredImage[];
}
