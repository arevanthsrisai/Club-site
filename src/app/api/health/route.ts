import { NextResponse } from 'next/server';

/**
 * Readiness endpoint used by systemd (ExecStartPost) and external monitors.
 * Deliberately touches no Firebase/email state so it can answer even when
 * runtime secrets are absent or slow, e.g. right after boot.
 */
export const dynamic = 'force-dynamic';

export function GET() {
    return NextResponse.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
    });
}
