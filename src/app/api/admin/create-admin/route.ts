import { NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/serverAuth';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { normalizeEmail } from '@/lib/normalizeEmail';
import { Timestamp } from 'firebase-admin/firestore';
import { CTO_ROLE, DEFAULT_ROLE_ID, DEFAULT_ROLES } from '@/lib/roles';

/** Check if role limit is exceeded */
async function checkRoleLimit(db: any, role: string): Promise<boolean> {
    let limit: number | null;
    if (role === CTO_ROLE.id) {
        limit = CTO_ROLE.limit;
    } else {
        const snap = await db.collection('club_roles').doc(role).get();
        const def = snap.exists() ? snap.data() : DEFAULT_ROLES.find(r => r.id === role);
        if (!def) throw new Error(`Unknown role: ${role}`);
        limit = (def as any).limit ?? null;
    }
    if (limit === null) return true;

    const q = db.collection('admins').where('role', '==', role).where('status', '==', 'active');
    const snapshot = await q.get();
    return snapshot.size < limit;
}

export async function POST(request: Request) {
    try {
        // 1. Verify caller is CTO
        const authResult = await verifyAuthToken(request);
        if (!authResult) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const adminDb = getAdminFirestore();
        const callerDoc = await adminDb.collection('admins').doc(authResult.uid).get();
        if (!callerDoc.exists || callerDoc.data()?.role !== 'CTO') {
            return NextResponse.json({ error: 'Forbidden: CTO role required' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const emailRaw = body?.email;
        const password = body?.password;
        const role = body?.role;

        const normalized = normalizeEmail(emailRaw);
        if (!normalized) {
            return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
        }
        if (typeof password !== 'string' || password.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
        }
        if (!role || typeof role !== 'string') {
            return NextResponse.json({ error: 'Role is required' }, { status: 400 });
        }

        // 1b. Check role limit before proceeding
        const roleLimited = await checkRoleLimit(adminDb, role);
        if (!roleLimited) {
            return NextResponse.json({ error: `Role limit reached for ${role}. Cannot create admin.` }, { status: 409 });
        }

        const adminAuth = getAdminAuth();

        // 2. Check Firebase Auth for existing account (idempotent handling)
        let existingUser: { uid: string } | null = null;
        try {
            const u = await adminAuth.getUserByEmail(normalized);
            existingUser = { uid: u.uid };
        } catch (e: any) {
            if (e?.code !== 'auth/user-not-found') {
                throw e;
            }
        }

        // 3. Check Firestore admin record
        let existingAdminDoc: any = null;
        if (existingUser) {
            const snap = await adminDb.collection('admins').doc(existingUser.uid).get();
            if (snap.exists) existingAdminDoc = snap.data();
        }

        // Safety: do not silently promote an existing non-admin or existing admin
        if (existingUser && existingAdminDoc) {
            return NextResponse.json(
                { error: 'An admin account already exists for this email.' },
                { status: 409 }
            );
        }
        if (existingUser && !existingAdminDoc) {
            // Orphaned Auth account from a previous failed attempt.
            // Provide a safe recovery path: do not auto-create admin record without explicit confirmation.
            // Require explicit recovery flag.
            if (body?.recoverOrphan !== true) {
                return NextResponse.json(
                    {
                        error: 'An authentication account exists for this email but has no admin record. Pass recoverOrphan:true to link it, or delete the auth account first.',
                        orphanUid: existingUser.uid,
                    },
                    { status: 409 }
                );
            }
            // Recovery: create admin record linked to existing uid, do NOT reset password
            await adminDb.collection('admins').doc(existingUser.uid).set({
                uid: existingUser.uid,
                email: normalized,
                role,
                status: 'active',
                createdAt: Timestamp.now(),
                approvedAt: Timestamp.now(),
            });
            // audit log best-effort
            try {
                await adminDb.collection('audit_logs').add({
                    actorUid: authResult.uid,
                    action: 'CREATE_ADMIN_DIRECT_RECOVER',
                    targetUid: existingUser.uid,
                    email: normalized,
                    role,
                    timestamp: Timestamp.now(),
                });
            } catch {}
            return NextResponse.json({ success: true, uid: existingUser.uid, recovered: true });
        }

        // 4. Create new Auth user
        let createdUid: string | null = null;
        try {
            const created = await adminAuth.createUser({
                email: normalized,
                password,
                emailVerified: false,
            });
            createdUid = created.uid;

            // 5. Create admin record server-side
            await adminDb.collection('admins').doc(created.uid).set({
                uid: created.uid,
                email: normalized,
                role,
                status: 'active',
                createdAt: Timestamp.now(),
                approvedAt: Timestamp.now(),
            });

            // audit log
            try {
                await adminDb.collection('audit_logs').add({
                    actorUid: authResult.uid,
                    action: 'CREATE_ADMIN_DIRECT',
                    targetUid: created.uid,
                    email: normalized,
                    role,
                    timestamp: Timestamp.now(),
                });
            } catch {}

            return NextResponse.json({ success: true, uid: created.uid });
        } catch (err: any) {
            // Rollback: delete orphaned Auth user if Firestore write failed
            if (createdUid) {
                try { await adminAuth.deleteUser(createdUid); } catch {}
            }
            throw err;
        }
    } catch (error: any) {
        console.error('create-admin error:', error);
        const msg = error?.message || 'Internal server error';
        // Avoid leaking sensitive firebase details
        if (error?.code === 'auth/email-already-in-use') {
            return NextResponse.json({ error: 'Email is already in use.' }, { status: 409 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
