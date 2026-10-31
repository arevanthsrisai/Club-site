import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
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
export const storage = getStorage(app);
export const auth = getAuth(app);

// Firestore is initialized lazily on first access. The database ID is a
// runtime requirement: we must never silently connect to the default
// database. Initializing eagerly at module scope would throw during Next.js
// page-data collection (which imports route modules without the full runtime
// environment), so we defer the check to the first actual use. All services
// and pages that touch Firestore will fail loudly with a clear configuration
// error if the database ID is missing at runtime.
let _db: Firestore | null = null;

function getDatabaseId(): string {
    const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID;
    if (!databaseId || databaseId.trim() === "") {
        throw new Error(
            "NEXT_PUBLIC_FIRESTORE_DATABASE_ID is required. " +
            "Set it in .env.local (e.g., default-clone) or your build environment."
        );
    }
    return databaseId.trim();
}

function resolveDb(): Firestore {
    if (!_db) {
        const databaseId = getDatabaseId();
        _db = getFirestore(app, databaseId);
    }
    return _db;
}

// Exported as a proxy so existing `import { db } from "@/lib/firebase"` call
// sites keep working while the actual Firestore instance is created lazily.
// The proxy intercepts the Firebase SDK's _delegate property (used by
// getModularInstance()) to return the real Firestore instance, which makes
// the SDK's instanceof checks pass. All other property access is forwarded
// via Reflect.get with proper 'this' binding for method calls.
export const db: Firestore = new Proxy({} as Firestore, {
    get(_target, prop, receiver) {
        const firestore = resolveDb();
        // Firebase SDK's getModularInstance() checks for _delegate and unwraps
        // it before doing instanceof checks. Return the real instance so those
        // checks pass (e.g., collection(db, "x") and db.collection("x")).
        if (prop === '_delegate') return firestore;
        // Use Reflect.get with the proxy as receiver so that method calls
        // (e.g., db.collection('x')) have `this` bound to the proxy, which
        // then unwraps via _delegate for the SDK's instanceof checks.
        return Reflect.get(firestore, prop, receiver);
    },
});

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
