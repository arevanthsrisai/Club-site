import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getAdminContext, unauthorized, forbidden } from '@/lib/serverAuthz';

// Allowed recipient domains (prevents open relay abuse)
const ALLOWED_RECIPIENT_DOMAINS = [
    'av.students.amrita.edu',
    'av.amrita.edu',
    'gmail.com', // For reluavv@gmail.com notifications
];

function escapeHtml(value: string) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(request: Request) {
    try {
        // Only an active CTO approves admins, which is the only flow that sends
        // mail. getAdminContext rejects deactivated and Ex-Core accounts even
        // when their stored role still says CTO.
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!ctx.isCTO) return forbidden('CTO');

        const { to, subject, text } = await request.json();
        if (typeof to !== 'string' || typeof subject !== 'string' || typeof text !== 'string' || !to || !subject || !text) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const recipientDomain = to.split('@')[1]?.toLowerCase();
        if (!recipientDomain || !ALLOWED_RECIPIENT_DOMAINS.includes(recipientDomain)) {
            return NextResponse.json(
                { error: `Emails can only be sent to: ${ALLOWED_RECIPIENT_DOMAINS.join(', ')}` },
                { status: 400 }
            );
        }

        if (subject.length > 200 || text.length > 10000) {
            return NextResponse.json({ error: 'Field length exceeds limits' }, { status: 400 });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const info = await transporter.sendMail({
            from: `"ReLU - AI&ML Club" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text,
            html: escapeHtml(text).replace(/\n/g, '<br>'),
        });

        return NextResponse.json({ success: true, messageId: info.messageId });

    } catch (error) {
        console.error('Email send error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
