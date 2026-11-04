import { db } from "@/lib/firebase";
import { doc, getDoc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";

export interface OnboardingConfig {
    classes: string[];
    sections: string[];
}

const SETTINGS_DOC_ID = "onboarding_config";

export async function getOnboardingConfig(): Promise<OnboardingConfig> {
    try {
        const docRef = doc(db, "settings", SETTINGS_DOC_ID);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data() as OnboardingConfig;
        }
        // Default config if not found
        return {
            classes: ["AIE", "CSE", "CCE", "AIDS"],
            sections: ["A", "B", "C"]
        };
    } catch (error) {
        console.warn("Error fetching onboarding config:", error);
        return {
            classes: ["AIE", "CSE", "CCE", "AIDS"],
            sections: ["A", "B", "C"]
        };
    }
}

export async function updateOnboardingConfig(data: OnboardingConfig) {
    // Merge true allows us to update parts of it if needed, but here we likely replace arrays
    await setDoc(doc(db, "settings", SETTINGS_DOC_ID), data, { merge: true });
}

// --- Birthday e-mails -------------------------------------------------------
//
// `automatic` is the switch the scheduled route reads before mailing anyone;
// the last-run fields are written by the server after a scheduled send, and
// `sentToday` is the per-recipient guard that makes both the manual and the
// scheduled path idempotent for the day. Only the CTO may write this document
// (firestore.rules: settings writes are CTO-only).

export const BIRTHDAY_SETTINGS_DOC_ID = "birthday_emails";

export interface BirthdayEmailSettings {
    automatic: boolean;
    lastRunDate?: string;
    lastRunAt?: any;
    lastRunCount?: number;
    lastRunFailed?: number;
    sentToday?: { date: string; emails: string[] };
}

export function subscribeToBirthdayEmailSettings(callback: (settings: BirthdayEmailSettings) => void) {
    return onSnapshot(doc(db, "settings", BIRTHDAY_SETTINGS_DOC_ID), snap => {
        const data = snap.data() as Partial<BirthdayEmailSettings> | undefined;
        callback({
            automatic: data?.automatic === true,
            lastRunDate: data?.lastRunDate,
            lastRunAt: data?.lastRunAt ?? null,
            lastRunCount: data?.lastRunCount,
            lastRunFailed: data?.lastRunFailed,
            sentToday: data?.sentToday,
        });
    }, err => {
        console.warn("Error loading birthday e-mail settings:", err);
    });
}

export async function setBirthdayEmailsAutomatic(automatic: boolean) {
    await setDoc(doc(db, "settings", BIRTHDAY_SETTINGS_DOC_ID), { automatic }, { merge: true });
}
