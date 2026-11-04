import { NextResponse } from "next/server";
import { getAdminContext, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
    clubToday,
    collectTodayBirthdays,
    getBirthdayEmailSettings,
    sendBirthdayWishes,
} from "@/lib/birthdayEmails";

export const dynamic = "force-dynamic";

/**
 * GET /api/birthday-send — preview for the dashboard card.
 *
 * Returns today's celebrants (team and students, de-duplicated by address),
 * the automation state and how many of them already received a wish today.
 * Any approved admin may look; only the CTO may send (see POST).
 */
export async function GET(request: Request) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();

    try {
        const db = getAdminFirestore();
        const { parts, key } = clubToday();
        const [recipients, settings] = await Promise.all([
            collectTodayBirthdays(db, parts),
            getBirthdayEmailSettings(db),
        ]);

        const mailedToday = new Set(
            settings.sentToday?.date === key ? settings.sentToday.emails.map(e => e.toLowerCase()) : []
        );

        return NextResponse.json({
            date: key,
            timeZone: process.env.CLUB_TIMEZONE || "Asia/Kolkata",
            automatic: settings.automatic,
            lastRunDate: settings.lastRunDate ?? null,
            lastRunAt: settings.lastRunAt ?? null,
            lastRunCount: settings.lastRunCount ?? null,
            lastRunFailed: settings.lastRunFailed ?? null,
            canSend: ctx.isCTO,
            recipients: recipients.map(person => ({
                name: person.name,
                kind: person.kind,
                alreadySent: mailedToday.has(person.email.toLowerCase()),
                photoURL: person.photoURL,
            })),
        });
    } catch (error) {
        console.error("Birthday preview error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * POST /api/birthday-send — send today's wishes now.
 *
 * CTO-only, and idempotent per person per day: anyone already wished today
 * (for example by the morning scheduler) is skipped rather than mailed twice.
 */
export async function POST(request: Request) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        // Bulk mail to every member of the club is a CTO-only operation,
        // matching /api/send-email.
        if (!ctx.isCTO) return forbidden("CTO");

        const result = await sendBirthdayWishes(getAdminFirestore(), { mode: "manual" });

        if (result.status === "not-configured") {
            return NextResponse.json(
                { error: "E-mail is not configured on this server (EMAIL_USER / EMAIL_PASS)." },
                { status: 503 },
            );
        }

        if (result.sent.length > 0) {
            await logServerActivity(ctx.uid, ctx.name, "BIRTHDAY_EMAILS_SENT", {
                count: result.sent.length,
                date: result.date,
                recipients: result.sent,
                source: "manual",
            });
        }

        return NextResponse.json({
            success: true,
            date: result.date,
            sent: result.sent.length,
            alreadySent: result.alreadySent.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
            message: result.recipients.length === 0
                ? "No birthdays today."
                : result.failed.length > 0
                    ? `${result.sent.length} sent, ${result.failed.length} failed — try again to retry the failures.`
                    : result.sent.length === 0
                        ? "Everyone with a birthday today has already been wished."
                        : undefined,
        });
    } catch (error) {
        console.error("Birthday email error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
