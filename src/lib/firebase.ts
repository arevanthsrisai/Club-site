import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "mock-key",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "mock-domain",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "mock-project",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "mock-bucket",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "mock-sender",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "mock-app-id",
    // Optional. Only set when Google Analytics is linked to this Firebase web
    // app (Firebase console > Project settings > Integrations). Without it,
    // loading Analytics would fetch gtag/js with an undefined id and 404.
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || undefined,
};

const analyticsEnabled = Boolean(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID);

import { getAnalytics, isSupported } from "firebase/analytics";

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
// Database ID configuration — required, no silent fallback to (default)
const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID;
if (!databaseId || databaseId.trim() === "") {
    throw new Error("NEXT_PUBLIC_FIRESTORE_DATABASE_ID is required. Set it in .env.local (e.g., default-clone).");
}
const db = getFirestore(app, databaseId);
const storage = getStorage(app);
const auth = getAuth(app);

// Analytics sets cookies, so it only starts once the visitor accepts them (see CookieConsent).
export function enableAnalytics() {
    if (typeof window === "undefined") return;
    if (!analyticsEnabled) {
        // Debug-level, not an error: GA simply isn't configured for this project.
        console.debug(
            "Analytics skipped: NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID is not set"
        );
        return;
    }
    isSupported().then((supported) => {
        if (supported) getAnalytics(app);
    });
}

export { db, storage, auth };
