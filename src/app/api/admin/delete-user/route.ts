import { NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/serverAuth';
import { getAdminContext, forbidden, logServerActivity } from '@/lib/serverAuthz';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';

/**
 * DELETE /api/admin/delete-user?uid=<targetUid>
 *
 * Deletes the Firebase Auth account and the account's Firestore identity docs
 * (users, admins, pending_registrations). Historical registrations/feedback
 * are intentionally kept.
 *
 * Authorization:
 *  - A signed-in user may delete their OWN account. This is required by the
 *    tenure-expiry purge: deleteUserData() removes the Firestore docs first,
 *    so an admin-profile based check would reject the very same caller.
 *  - Deleting anyone else requires an active CTO, resolved server-side from
 *    the verified token (never from the request body).
 *
 * The Auth account is removed first: a failure afterwards can leave orphaned
 * Firestore rows, but never leaves a working login for a "deleted" account.
 */
export async function DELETE(request: Request) {
    try {
        // 1. Verify the caller from the ID token.
        const authResult = await verifyAuthToken(request);
        if (!authResult) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const targetUid = url.searchParams.get('uid');
        if (!targetUid) {
            return NextResponse.json({ error: 'Missing uid parameter' }, { status: 400 });
        }

        // 2. Self-deletion is allowed; deleting another account is CTO-only.
        const isSelf = targetUid === authResult.uid;
        let actorName = 'Self';
        if (!isSelf) {
            const ctx = await getAdminContext(request);
            if (!ctx) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            if (!ctx.isCTO) return forbidden('CTO');
            actorName = ctx.name;
        }

        // 3. Remove sign-in access first.
        try {
            await getAdminAuth().deleteUser(targetUid);
        } catch (error: any) {
            if (error?.code !== 'auth/user-not-found') throw error;
        }

        // 4. Remove the account's Firestore identity records (Admin SDK).
        const adminDb = getAdminFirestore();
        const batch = adminDb.batch();
        batch.delete(adminDb.collection('users').doc(targetUid));
        batch.delete(adminDb.collection('admins').doc(targetUid));
        batch.delete(adminDb.collection('pending_registrations').doc(targetUid));
        await batch.commit();

        if (isSelf) {
            await logServerActivity(targetUid, 'Self', 'DELETE_OWN_ACCOUNT', { targetUid });
        } else {
            await logServerActivity(authResult.uid, actorName, 'DELETE_USER_ACCOUNT', { targetUid });
        }

        return NextResponse.json({ success: true, message: `Account ${targetUid} deleted` });
    } catch (error: any) {
        if (error?.code === 'auth/user-not-found') {
            return NextResponse.json({ success: true, message: 'Auth account already deleted' });
        }
        console.error('Delete user error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
