import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { logServerActivity } from "@/lib/serverAuthz";
import { clubTimeZone, clubToday, sendBirthdayWishes } from "@/lib/birthdayEmails";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/birthdays — the daily birthday mailer.
 *
 * Called by the scheduler (systemd timer on the VPS, or Cloud Scheduler), not
 * by a browser. It carries no user session, so it authenticates with the
 * shared CRON_SECRET instead:
 *
 *   curl -fsS -X POST https://<host>/api/cron/birthdays \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Fails closed: without CRON_SECRET configured the route is disabled (503),
 * and a wrong/missing token is 401. The CTO's "automatic" switch in the
 * dashboard is honored here — manual sends ignore it. Runs are idempotent per
 * person per club-local day, so retries and overlapping runs are harmless.
 */
function authorized(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const header = request.headers.get("authorization") || "";
    const expected = `Bearer ${secret}`;
    const given = Buffer.from(header);
    const want = Buffer.from(expected);
    if (given.length !== want.length) return false;
    return timingSafeEqual(given, want);
}

async function run(request: Request) {
    if (!process.env.CRON_SECRET) {
        return NextResponse.json({ error: "CRON_SECRET is not configured; scheduled mail is disabled." }, { status: 503 });
    }
    if (!authorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await sendBirthdayWishes(getAdminFirestore(), { mode: "auto" });

        if (result.status === "disabled") {
            return NextResponse.json({
                success: true,
                skipped: "automatic-sending-disabled",
                date: result.date,
                timeZone: clubTimeZone(),
            });
        }
        if (result.status === "not-configured") {
            return NextResponse.json({ error: "E-mail is not configured on this server (EMAIL_USER / EMAIL_PASS)." }, { status: 503 });
        }

        if (result.sent.length > 0) {
            await logServerActivity("system", "Birthday scheduler", "BIRTHDAY_EMAILS_SENT", {
                count: result.sent.length,
                date: result.date,
                recipients: result.sent,
                failed: result.failed,
                source: "scheduled",
            });
        }

        return NextResponse.json({
            success: true,
            date: result.date,
            timeZone: clubTimeZone(),
            birthdays: result.recipients.length,
            sent: result.sent.length,
            alreadySent: result.alreadySent.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
        });
    } catch (error) {
        console.error("Scheduled birthday email error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return run(request);
}

export async function POST(request: Request) {
    return run(request);
}
