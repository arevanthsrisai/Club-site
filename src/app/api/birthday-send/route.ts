import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getAdminContext, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { isBirthdayToday } from "@/lib/birthdays";

// Same recipient allow-list as /api/send-email so bulk birthday mail never
// becomes an open relay.
const ALLOWED_RECIPIENT_DOMAINS = [
    "av.students.amrita.edu",
    "av.amrita.edu",
    "gmail.com",
];

function escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface BirthdayPerson {
    name: string;
    email: string;
    role?: string;
}

export async function POST(request: Request) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        // Bulk mail to every member of the club is a CTO-only operation,
        // matching /api/send-email.
        if (!ctx.isCTO) return forbidden("CTO");

        const db = getAdminFirestore();
        const now = new Date();
        const birthdayPeople: BirthdayPerson[] = [];

        // Admins — only active ones get wishes.
        const adminsSnap = await db.collection("admins").get();
        adminsSnap.forEach(doc => {
            const d = doc.data() as {
                email?: string; displayName?: string; dob?: string; status?: string; role?: string;
            };
            if (d.status !== "active") return;
            if (!d.email || !d.dob) return;
            if (isBirthdayToday(d.dob, now)) {
                birthdayPeople.push({ name: d.displayName || d.email, email: d.email, role: d.role });
            }
        });

        // Students — anyone with a DOB set on their profile.
        const usersSnap = await db.collection("users").get();
        usersSnap.forEach(doc => {
            const d = doc.data() as { email?: string; displayName?: string; dob?: string };
            if (!d.email || !d.dob) return;
            if (isBirthdayToday(d.dob, now)) {
                birthdayPeople.push({ name: d.displayName || d.email, email: d.email });
            }
        });

        if (birthdayPeople.length === 0) {
            return NextResponse.json({ success: true, sent: 0, message: "No birthdays today." });
        }

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });

        let sent = 0;
        for (const person of birthdayPeople) {
            const domain = person.email.split("@")[1]?.toLowerCase();
            if (!domain || !ALLOWED_RECIPIENT_DOMAINS.includes(domain)) continue;

            const subject = `Happy Birthday, ${person.name}! 🎂`;
            const text =
                `Hi ${person.name},\n\n` +
                `Wishing you a very happy birthday from the ReLU Club! Hope you have a wonderful day.\n\n` +
                `— ReLU Club`;
            const html = escapeHtml(text).replace(/\n/g, "<br>");

            await transporter.sendMail({
                from: `"ReLU - AI&ML Club" <${process.env.EMAIL_USER}>`,
                to: person.email,
                subject,
                text,
                html,
            });
            sent++;
        }

        await logServerActivity(ctx.uid, ctx.name, "BIRTHDAY_EMAILS_SENT", {
            count: sent,
            date: now.toISOString().slice(0, 10),
            recipients: birthdayPeople.map(p => p.email),
        });

        return NextResponse.json({ success: true, sent });
    } catch (error) {
        console.error("Birthday email error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
