import nodemailer from "nodemailer";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { calendarPartsInTimeZone, isBirthdayOnParts, type DateParts } from "./birthdays";

/**
 * Server-only birthday mail: one implementation shared by the manual
 * "Send wishes" button (/api/birthday-send) and the daily scheduler
 * (/api/cron/birthdays), so the two paths can never drift and can never
 * double-mail the same person on the same day.
 *
 * Nothing here is client-safe: it reads with the Admin SDK and talks to SMTP.
 */

export const BIRTHDAY_SETTINGS_DOC = "birthday_emails";

/** Club-local timezone used to decide what "today" is for scheduled mail. */
export function clubTimeZone(): string {
    return process.env.CLUB_TIMEZONE || "Asia/Kolkata";
}

/**
 * Same recipient allow-list as /api/send-email so birthday mail can never
 * become an open relay, even if a profile holds an arbitrary address.
 */
export const ALLOWED_RECIPIENT_DOMAINS = [
    "av.students.amrita.edu",
    "av.amrita.edu",
    "gmail.com",
];

export interface BirthdayRecipient {
    name: string;
    email: string;
    kind: "team" | "student";
    /** May be populated from the stored member profile; ignored by the mail path. */
    photoURL?: string;
}

export interface BirthdayEmailSettings {
    /** When true the scheduled route actually sends. */
    automatic: boolean;
    /** Club-local date (YYYY-MM-DD) of the last scheduled send. */
    lastRunDate?: string;
    lastRunAt?: Timestamp | null;
    lastRunCount?: number;
    /** How many addresses in the last scheduled run failed to send. */
    lastRunFailed?: number;
    /** Per-recipient guard: who already received a wish on `date`. */
    sentToday?: { date: string; emails: string[] };
}

export interface BirthdaySendResult {
    /** Club-local date the run belongs to. */
    date: string;
    /** Everyone whose birthday it is today, before de-duplication by address. */
    recipients: BirthdayRecipient[];
    /** Addresses mailed by this run. */
    sent: string[];
    /** Today's celebrants skipped because they already got a wish today. */
    alreadySent: string[];
    /** Celebrants whose address is outside the allow-list (or missing). */
    skipped: string[];
    /** Addresses whose send threw; they stay unrecorded, so a retry mails them. */
    failed: string[];
    /** `disabled` = automation is off (scheduled runs); `not-configured` = no SMTP. */
    status: "ok" | "disabled" | "not-configured";
}

function dateKey(parts: DateParts): string {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Today in the club's timezone, not the server's. */
export function clubToday(at: Date = new Date()): { parts: DateParts; key: string } {
    const parts = calendarPartsInTimeZone(clubTimeZone(), at);
    return { parts, key: dateKey(parts) };
}

export async function getBirthdayEmailSettings(db: Firestore): Promise<BirthdayEmailSettings> {
    const snap = await db.collection("settings").doc(BIRTHDAY_SETTINGS_DOC).get();
    const data = (snap.exists ? snap.data() : undefined) as Partial<BirthdayEmailSettings> | undefined;
    return {
        automatic: data?.automatic === true,
        lastRunDate: typeof data?.lastRunDate === "string" ? data.lastRunDate : undefined,
        lastRunAt: data?.lastRunAt ?? null,
        lastRunCount: typeof data?.lastRunCount === "number" ? data.lastRunCount : undefined,
        lastRunFailed: typeof data?.lastRunFailed === "number" ? data.lastRunFailed : undefined,
        sentToday: data?.sentToday && typeof data.sentToday.date === "string" && Array.isArray(data.sentToday.emails)
            ? { date: data.sentToday.date, emails: data.sentToday.emails.filter(e => typeof e === "string") }
            : undefined,
    };
}

/**
 * Everyone — active team member or registered student — whose stored DOB
 * matches today. De-duplicated case-insensitively by address, because an admin
 * profile and a student profile can share one mailbox.
 */
export async function collectTodayBirthdays(db: Firestore, today: DateParts): Promise<BirthdayRecipient[]> {
    const [adminsSnap, usersSnap] = await Promise.all([
        db.collection("admins").get(),
        db.collection("users").get(),
    ]);

    const byEmail = new Map<string, BirthdayRecipient>();

    adminsSnap.forEach(doc => {
        const d = doc.data() as { email?: string; displayName?: string; dob?: string; status?: string; photoURL?: string };
        if (d.status !== "active" || !d.email || !d.dob) return;
        if (!isBirthdayOnParts(d.dob, today)) return;
        const key = d.email.toLowerCase();
        if (!byEmail.has(key)) {
            byEmail.set(key, { name: d.displayName || d.email, email: d.email, kind: "team", photoURL: d.photoURL ?? undefined });
        }
    });

    usersSnap.forEach(doc => {
        const d = doc.data() as { email?: string; displayName?: string; dob?: string; photoURL?: string };
        if (!d.email || !d.dob) return;
        if (!isBirthdayOnParts(d.dob, today)) return;
        const key = d.email.toLowerCase();
        if (!byEmail.has(key)) {
            byEmail.set(key, { name: d.displayName || d.email, email: d.email, kind: "student", photoURL: d.photoURL ?? undefined });
        }
    });

    return [...byEmail.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
}

function escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mailConfigured(): boolean {
    return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

export interface SendBirthdayOptions {
    /** `manual` ignores the automatic toggle; `auto` obeys it. */
    mode: "manual" | "auto";
    at?: Date;
}

/**
 * Sends today's birthday wishes.
 *
 * Idempotent per person per day: the settings document records who was mailed
 * on the current club-local date, so a scheduled run after a manual send (or a
 * cron retry, or two overlapping runs) sends nothing twice. Nothing is recorded
 * when the mailer is not configured, so a later run can still deliver.
 */
export async function sendBirthdayWishes(
    db: Firestore,
    { mode, at = new Date() }: SendBirthdayOptions,
): Promise<BirthdaySendResult> {
    const { parts, key } = clubToday(at);
    const settings = await getBirthdayEmailSettings(db);
    const recipients = await collectTodayBirthdays(db, parts);

    const empty = (status: BirthdaySendResult["status"]): BirthdaySendResult => ({
        date: key,
        recipients,
        sent: [],
        alreadySent: [],
        skipped: [],
        failed: [],
        status,
    });

    if (mode === "auto" && !settings.automatic) return empty("disabled");
    if (!mailConfigured()) return empty("not-configured");

    const alreadyMailed = new Set(
        settings.sentToday?.date === key ? settings.sentToday.emails.map(e => e.toLowerCase()) : []
    );

    const skipped: string[] = [];
    const pending: BirthdayRecipient[] = [];

    for (const person of recipients) {
        const email = person.email.toLowerCase();
        if (alreadyMailed.has(email)) continue;
        const domain = person.email.split("@")[1]?.toLowerCase();
        if (!domain || !ALLOWED_RECIPIENT_DOMAINS.includes(domain)) {
            skipped.push(person.email);
            continue;
        }
        pending.push(person);
    }

    const alreadySent = recipients
        .filter(person => alreadyMailed.has(person.email.toLowerCase()))
        .map(person => person.email);

    if (pending.length === 0) {
        return { ...empty("ok"), alreadySent, skipped };
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const sent: string[] = [];
    const failed: string[] = [];
    for (const person of pending) {
        const subject = `Happy Birthday, ${person.name}! 🎂`;
        const text =
            `Hi ${person.name},\n\n` +
            `Wishing you a very happy birthday from the ReLU Club! Hope you have a wonderful day.\n\n` +
            `— ReLU Club`;
        const html = escapeHtml(text).replace(/\n/g, "<br>");

        // One unusable address or SMTP hiccup must not abort the whole run:
        // the successes below still get recorded, so a retry mails only the
        // people who actually missed out.
        try {
            await transporter.sendMail({
                from: `"ReLU - AI&ML Club" <${process.env.EMAIL_USER}>`,
                to: person.email,
                subject,
                text,
                html,
            });
            sent.push(person.email);
        } catch (error) {
            console.error(`Birthday e-mail to ${person.email} failed:`, error);
            failed.push(person.email);
        }
    }

    const mailedToday = [...new Set([...alreadyMailed, ...sent.map(e => e.toLowerCase())])];
    const update: Record<string, unknown> = {
        sentToday: { date: key, emails: mailedToday },
    };
    if (mode === "auto") {
        update.lastRunDate = key;
        update.lastRunAt = Timestamp.now();
        update.lastRunCount = sent.length;
        update.lastRunFailed = failed.length;
    }
    await db.collection("settings").doc(BIRTHDAY_SETTINGS_DOC).set(update, { merge: true });

    return { date: key, recipients, sent, alreadySent, skipped, failed, status: "ok" };
}
