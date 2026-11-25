import { NextResponse } from 'next/server';
import { getAdminContext, unauthorized, forbidden } from '@/lib/serverAuthz';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';

export async function DELETE(request: Request) {
    try {
        // 1. Verify the caller is an active CTO (not merely a stale role string).
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!ctx.isCTO) return forbidden('CTO');

        const adminDb = getAdminFirestore();

        // 2. Get target UID
        const url = new URL(request.url);
        const targetUid = url.searchParams.get('uid');
        if (!targetUid) {
            return NextResponse.json({ error: 'Missing uid parameter' }, { status: 400 });
        }

        // 3. Prevent self-deletion
        if (targetUid === ctx.uid) {
            return NextResponse.json({ error: 'Cannot revoke your own access' }, { status: 400 });
        }

        // 4. Check target admin exists and is not the last CTO
        const targetDoc = await adminDb.collection('admins').doc(targetUid).get();
        if (!targetDoc.exists) {
            return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
        }

        const targetData = targetDoc.data();
        if (targetData?.role === 'CTO') {
            // Check if this is the only CTO
            const ctoQuery = await adminDb.collection('admins').where('role', '==', 'CTO').get();
            if (ctoQuery.size <= 1) {
                return NextResponse.json({ error: 'Cannot remove the last CTO' }, { status: 409 });
            }
        }

        // 5. Delete Firestore records using Admin SDK
        const batch = adminDb.batch();
        batch.delete(adminDb.collection('users').doc(targetUid));
        batch.delete(adminDb.collection('admins').doc(targetUid));
        batch.delete(adminDb.collection('pending_registrations').doc(targetUid));
        await batch.commit();

        // 6. Delete Firebase Auth account (best-effort, idempotent)
        try {
            await getAdminAuth().deleteUser(targetUid);
        } catch (e: any) {
            if (e?.code !== 'auth/user-not-found') {
                console.warn('Auth account deletion failed:', e);
                // Non-fatal: Firestore data is already deleted
            }
        }

        // 7. Audit log
        try {
            await adminDb.collection('audit_logs').add({
                action: 'REVOKE_ADMIN',
                actorUid: ctx.uid,
                targetUid,
                email: targetData?.email,
                timestamp: Timestamp.now(),
            });
        } catch {}

        return NextResponse.json({ success: true, message: 'Access revoked' });

    } catch (error: any) {
        console.error('delete-admin error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}