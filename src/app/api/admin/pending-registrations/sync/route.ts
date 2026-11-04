import { NextResponse } from 'next/server';
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from '@/lib/serverAuthz';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/pending-registrations/sync
 *
 * Repairs the admin approval queue: every admins/{uid} whose role is still
 * "pending" must have a matching pending_registrations/{uid} request, but
 * firestore.rules only allow a client to create its own request
 * (`allow create: if isOwner(userId)`). The CTO console therefore cannot
 * recreate another admin's request from the browser — this route does it with
 * the Admin SDK for callers holding "team.manage".
 *
 * Idempotent: existing request documents are left untouched (and never
 * overwritten), so a second run restores nothing.
 */
export async function POST(request: Request) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, 'team.manage')) return forbidden('team.manage');

    try {
        const db = getAdminFirestore();

        const [pendingAdmins, existingRequests] = await Promise.all([
            db.collection('admins').where('role', '==', 'pending').get(),
            db.collection('pending_registrations').get(),
        ]);

        const existingIds = new Set(existingRequests.docs.map(d => d.id));
        const restored: string[] = [];

        for (const adminDoc of pendingAdmins.docs) {
            if (existingIds.has(adminDoc.id)) continue;

            const data = adminDoc.data() as { email?: unknown; createdAt?: unknown };
            const email = typeof data.email === 'string' ? data.email : '';
            if (!email) continue;

            await db.collection('pending_registrations').doc(adminDoc.id).set({
                email,
                requestedAt: data.createdAt ?? Timestamp.now(),
            });
            restored.push(email);
        }

        await logServerActivity(ctx.uid, ctx.name, 'SYNC_PENDING_REGISTRATIONS', {
            scanned: pendingAdmins.size,
            restored: restored.length,
        });

        return NextResponse.json({
            scanned: pendingAdmins.size,
            restored: restored.length,
            emails: restored.slice(0, 50),
        });
    } catch (error) {
        console.error('pending-registrations sync failed:', error);
        return NextResponse.json({ error: 'Sync failed.' }, { status: 500 });
    }
}
