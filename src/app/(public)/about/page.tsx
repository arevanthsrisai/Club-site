import { Metadata } from 'next';
import AboutClient from './AboutClient';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { AdminProfile } from '@/types';
import { ClubRole, withBuiltIns } from '@/lib/roles';

export const metadata: Metadata = {
    title: 'Team & About',
    description: 'The current ReLU team and the founders of the club.',
};

export const revalidate = 0;

// Admin profiles are not publicly readable (they hold DOB and roll numbers),
// so the server picks out the fields the team cards show.
export default async function AboutPage() {
    let team: AdminProfile[] = [];
    let roles: ClubRole[] = withBuiltIns([]);
    try {
        const db = getAdminFirestore();
        const roleSnap = await db.collection('club_roles').get();
        roles = withBuiltIns(roleSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClubRole)));
        const snap = await db.collection('admins').where('status', '==', 'active').get();
        team = snap.docs
            .map(d => d.data() as AdminProfile)
            .filter(u => u.role !== 'pending')
            .map(({ uid, email, role, status, displayName, photoURL, socials }) =>
                ({ uid, email, role, status, createdAt: null, displayName, photoURL, socials }));
    } catch (error) {
        console.error('Failed to load team:', error);
    }
    return <AboutClient team={team} roles={roles} />;
}
