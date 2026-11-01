import { Metadata } from 'next';
import ExCoreClient from './ExCoreClient';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import type { ExCoreMember } from '@/lib/excore';

export const metadata: Metadata = {
    title: 'Ex-Core',
    description: 'Former ReLU Core members and Activators, organized by the batch they stepped down in.',
};

export const revalidate = 0;

// Only the public fields the client renders, as plain JSON-serializable data —
// Firestore Timestamps and doc prototypes cannot cross into a Client Component.
function toPlainMember(doc: { id: string; data: () => Record<string, unknown> }): ExCoreMember {
    const d = doc.data();
    return {
        id: doc.id,
        name: typeof d.name === 'string' ? d.name : '',
        photoURL: typeof d.photoURL === 'string' ? d.photoURL : null,
        bio: typeof d.bio === 'string' ? d.bio : undefined,
        socials: (d.socials ?? {}) as ExCoreMember['socials'],
        memberType: d.memberType === 'activator' ? 'activator' : 'core',
        // NaN is a number "type" but never a valid batch → groupByBatchDesc
        // sinks malformed batches to the bottom of the page.
        exCoreBatch: typeof d.exCoreBatch === 'number' ? d.exCoreBatch : Number.NaN,
        roleHistory: Array.isArray(d.roleHistory)
            ? (d.roleHistory as { year: number; role: string }[])
            : [],
        displayOrder: typeof d.displayOrder === 'number' ? d.displayOrder : 0,
        linkedUserId: null,
    };
}

/**
 * Public Ex-Core page: former Core members & Activators by Ex-Core batch.
 * Reads only the public ex_core_members collection server-side.
 */
export default async function ExCorePage() {
    let members: ExCoreMember[] = [];
    try {
        const snap = await getAdminFirestore().collection('ex_core_members').get();
        members = snap.docs.map(toPlainMember);
    } catch (error) {
        console.error('Failed to load Ex-Core members:', error);
    }
    return <ExCoreClient members={members} />;
}
