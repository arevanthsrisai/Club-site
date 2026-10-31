import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Server-side Firebase Admin SDK initialization.
 * 
 * Uses a service account key stored as a base64-encoded JSON string
 * in the FIREBASE_ADMIN_KEY environment variable.
 * 
 * Fallback: If FIREBASE_ADMIN_KEY is not set, initializes with
 * project ID only (works on GCP-hosted environments with default credentials).
 * 
 * Database ID: Uses FIRESTORE_DATABASE_ID env var. Required — no silent fallback to (default).
 */

let adminApp: App;

function getAdminApp(): App {
    if (adminApp) return adminApp;

    const existingApps = getApps();
    if (existingApps.length > 0) {
        adminApp = existingApps[0];
        return adminApp;
    }

    const encodedKey = process.env.FIREBASE_ADMIN_KEY;

    if (encodedKey) {
        try {
            const serviceAccount = JSON.parse(
                Buffer.from(encodedKey, 'base64').toString('utf-8')
            );
            adminApp = initializeApp({
                credential: cert(serviceAccount),                projectId: serviceAccount.project_id,
            });
        } catch (error) {
            console.error('Failed to parse FIREBASE_ADMIN_KEY:', error);
            throw new Error('Invalid FIREBASE_ADMIN_KEY environment variable');
        }
    } else {
        // Fallback for environments with default credentials (GCP)
        adminApp = initializeApp({
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        });
    }

    return adminApp;
}

// Database ID for Admin SDK — required, no silent fallback to (default)
function getDatabaseId(): string {
    const id = process.env.FIRESTORE_DATABASE_ID;
    if (!id || id.trim() === "") {
        throw new Error("FIRESTORE_DATABASE_ID is required. Set it in .env.local (e.g., default-clone).");
    }
    return id.trim();
}

// Lazy-initialized exports
export function getAdminAuth() {
    return getAuth(getAdminApp());
}

export function getAdminFirestore() {
    return getFirestore(getAdminApp(), getDatabaseId());
}
