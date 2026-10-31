import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase";
import { collection, doc, getDocs, getDoc, addDoc, deleteDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { Resource, ResourceCategory } from "@/types";

// --- Resources API ---

export const RESOURCE_CATEGORIES: ResourceCategory[] = ["AIML", "DSA", "General"];

/**
 * Reading with a stable category contract: legacy documents (or any record
 * saved by an older version) whose category is missing or outside the known
 * set are surfaced as "General" so they always appear somewhere instead of
 * silently vanishing from every filter. The stored value is never rewritten.
 */
function normalizeCategory(value: unknown): ResourceCategory {
    return value === "AIML" || value === "DSA" ? value : "General";
}

export async function getResources(): Promise<Resource[]> {
    try {
        const querySnapshot = await getDocs(collection(db, "resources"));
        return querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            category: normalizeCategory((doc.data() as Resource).category),
        } as Resource));
    } catch (error) {
        console.warn("Firebase fetch failed (Resources):", error);
        return [];
    }
}

export async function createResource(resource: Omit<Resource, "id">) {
    const docRef = await addDoc(collection(db, "resources"), resource);
    return docRef.id;
}

/**
 * Deletes a resource document and its associated files from Storage.
 * Handles missing files gracefully (non-fatal).
 */
export async function deleteResource(id: string) {
    // Fetch the document first to get file URLs
    const docSnap = await getDoc(doc(db, "resources", id));
    if (docSnap.exists()) {
        const data = docSnap.data();

        // Delete associated files from Storage
        const urlsToDelete: string[] = [];
        if (data.url) urlsToDelete.push(data.url);
        if (data.thumbnailUrl) urlsToDelete.push(data.thumbnailUrl);

        for (const url of urlsToDelete) {
            try {
                const storageRef = ref(storage, url);
                await deleteObject(storageRef);
            } catch (err: any) {
                // Ignore "object-not-found": the file may already be deleted
                if (err.code !== 'storage/object-not-found') {
                    console.warn(`Failed to delete storage file: ${url}`, err);
                }
            }
        }
    }

    // Delete the Firestore document
    await deleteDoc(doc(db, "resources", id));
}
