import { NextResponse } from 'next/server';
import { FieldValue, Timestamp, type DocumentReference, type DocumentData } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/serverAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { teamRegistrationSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/rateLimit';

// Students cannot write registrations, invitations or feedback directly (see firestore.rules).
// Every student-side change goes through this route, which checks it against the caller's verified uid.

class ApiError extends Error {
    constructor(message: string, public status = 400) {
        super(message);
    }
}

type Body = Record<string, unknown>;

const MAX_CHECKIN_FAILURES = 5;
const FEEDBACK_KEYS = ['content', 'activities', 'interaction', 'organization', 'enjoyment', 'knowledgeable'];

const db = () => getAdminFirestore();

function text(body: Body, key: string): string {
    const value = body[key];
    if (typeof value !== 'string' || !value.trim()) throw new ApiError(`Missing ${key}`);
    return value.trim();
}

function rating(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
        throw new ApiError('Ratings must be whole numbers from 1 to 5');
    }
    return value;
}

async function getProfile(uid: string) {
    const snap = await db().collection('users').doc(uid).get();
    if (!snap.exists) throw new ApiError('Complete your profile first.');
    return snap.data()!;
}

async function getEvent(eventId: string) {
    const snap = await db().collection('events').doc(eventId).get();
    if (!snap.exists) throw new ApiError('Event not found', 404);
    return snap.data()!;
}

// The caller's registration for an event: their own doc as leader/individual, else a team they joined.
async function findRegistration(eventId: string, uid: string): Promise<{ ref: DocumentReference; data: DocumentData } | null> {
    const own = await db().collection('registrations').doc(`${eventId}_${uid}`).get();
    if (own.exists) return { ref: own.ref, data: own.data()! };

    const member = await db().collection('registrations')
        .where('eventId', '==', eventId)
        .where('participantIds', 'array-contains', uid)
        .limit(1)
        .get();
    return member.empty ? null : { ref: member.docs[0].ref, data: member.docs[0].data() };
}

// Count total individual participants across all registrations for an event.
async function countParticipants(eventId: string): Promise<number> {
    const snap = await db().collection('registrations').where('eventId', '==', eventId).get();
    let total = 0;
    for (const d of snap.docs) {        total += (d.data()?.participantIds as string[] | undefined)?.length || 1;    }
    return total;
}

// Get all waitlisted registrations for an event, oldest first.
async function getWaitlisted(eventId: string): Promise<{ id: string; data: DocumentData }[]> {
    const snap = await db().collection('registrations')
        .where('eventId', '==', eventId)
        .where('status', '==', 'waitlisted')
        .orderBy('registeredAt', 'asc')
        .get();
    return snap.docs.map(d => ({ id: d.id, data: d.data() }));
}

// --- Actions ---

async function register(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const profile = await getProfile(uid);
    if (!profile.rollNo || !profile.mobile) throw new ApiError('Complete your profile before registering.');

    const event = await getEvent(eventId);
    if (event.registrationStatus !== 'open') throw new ApiError('Registrations are closed.');
    if (await findRegistration(eventId, uid)) throw new ApiError('You are already registered for this event.');

    const isTeamEvent = (event.maxTeamSize || 1) > 1;
    let teamName: string | undefined;
    if (isTeamEvent) {
        const parsed = teamRegistrationSchema.safeParse({ teamName: typeof body.teamName === 'string' ? body.teamName.trim() : '' });
        if (!parsed.success) throw new ApiError(parsed.error.issues[0].message);
        teamName = parsed.data.teamName;

        const existing = await db().collection('registrations').where('eventId', '==', eventId).get();
        if (existing.docs.some(d => d.data().teamName?.trim().toLowerCase() === teamName!.toLowerCase())) {
            throw new ApiError(`Team name "${teamName}" is already taken for this event.`);
        }
    }

    // Max participants / waitlist enforcement
    if (event.maxParticipants) {
        const participantCount = await countParticipants(eventId);
        const remaining = event.maxParticipants - participantCount;
        const spotsNeeded = isTeamEvent ? (event.maxTeamSize || 1) : 1;
        if (remaining <= 0) {
            if (event.enableWaitlist) {
                const regId = `${eventId}_${uid}`;
                await db().collection('registrations').doc(regId).create({
                    id: regId,
                    eventId,
                    userId: uid,
                    userDetails: {
                        name: profile.displayName || 'Unknown',
                        rollNo: profile.rollNo,
                        class: profile.class || 'Unknown',
                        section: profile.section || 'Unknown',
                        mobile: profile.mobile,
                    },
                    registeredAt: Timestamp.now(),
                    status: 'waitlisted' as const,
                    participantIds: [uid],
                    ...(isTeamEvent && { teamName, teamMembers: [] }),
                });
                return { registrationId: regId, waitlisted: true };
            }
            throw new ApiError('Event is full. Registrations are closed.');
        }
        if (remaining < spotsNeeded && !event.enableWaitlist) {
            throw new ApiError(`Only ${remaining} spot(s) left for ${spotsNeeded} participant(s).`);
        }
    }

    const regId = `${eventId}_${uid}`;
    const status = isTeamEvent && (event.minTeamSize || 1) > 1 ? 'forming' : 'registered';
    const registration = {
        id: regId,
        eventId,
        userId: uid,
        userDetails: {
            name: profile.displayName || 'Unknown',
            rollNo: profile.rollNo,
            class: profile.class || 'Unknown',
            section: profile.section || 'Unknown',
            mobile: profile.mobile,
        },
        registeredAt: Timestamp.now(),
        status,
        participantIds: [uid],
        ...(isTeamEvent && { teamName, teamMembers: [] }),
    };

    try {
        await db().collection('registrations').doc(regId).create(registration);
    } catch (error: any) {
        if (error.code === 6) throw new ApiError('You are already registered for this event.'); // ALREADY_EXISTS
        throw error;
    }
    return { registrationId: regId };
}

async function searchStudents(uid: string, body: Body) {
    const term = text(body, 'term');
    if (term.length < 2) return { students: [] };
    const lower = term.toLowerCase();
    const upper = term.toUpperCase();

    // shortcut: scans the first 500 profiles; add a lowercase name/rollNo index if the user base grows past that.
    const snap = await db().collection('users').limit(500).get();
    const students = snap.docs
        .filter(d => d.id !== uid)
        .map(d => ({ uid: d.id, ...d.data() }) as { uid: string; displayName?: string; rollNo?: string; photoURL?: string })
        .filter(u => u.displayName?.toLowerCase().includes(lower) || u.rollNo?.toUpperCase().includes(upper))
        .slice(0, 20)
        // Only what the invite list shows; never email or mobile.
        .map(u => ({ uid: u.uid, displayName: u.displayName || '', rollNo: u.rollNo || '', photoURL: u.photoURL || '' }));
    return { students };
}

async function invite(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const targetUserId = text(body, 'targetUserId');
    if (targetUserId === uid) throw new ApiError('You are already on your team.');

    const regRef = db().collection('registrations').doc(`${eventId}_${uid}`);
    const reg = await regRef.get();
    if (!reg.exists || !reg.data()!.teamName) throw new ApiError('Create your team first.');
    const team = reg.data()!;

    const event = await getEvent(eventId);
    if (1 + (team.teamMembers?.length || 0) >= (event.maxTeamSize || 1)) throw new ApiError('Your team is already full.');

    const inviteRef = db().collection('invitations').doc(`${eventId}_${targetUserId}`);
    const existing = await inviteRef.get();
    if (existing.exists) {
        const status = existing.data()!.status;
        if (status === 'accepted') throw new ApiError('This student is already on a team for this event.');
        if (status === 'pending') throw new ApiError('This student already has a pending invitation for this event.');
    }
    if (await findRegistration(eventId, targetUserId)) throw new ApiError('This student is already registered for this event.');

    const [sender, target] = await Promise.all([getProfile(uid), db().collection('users').doc(targetUserId).get()]);
    if (!target.exists) throw new ApiError('Student not found.', 404);

    await inviteRef.set({
        id: inviteRef.id,
        eventId,
        eventTitle: event.title || '',
        teamName: team.teamName,
        registrationId: regRef.id,
        senderId: uid,
        senderName: sender.displayName || 'Unknown',
        targetUserId,
        targetName: target.data()!.displayName || 'Unknown',
        targetRollNo: target.data()!.rollNo || '',
        type: 'invite',
        status: 'pending',
        createdAt: Timestamp.now(),
    });
}

async function respond(uid: string, body: Body) {
    const invitationId = text(body, 'invitationId');
    const response = body.response;
    if (response !== 'accepted' && response !== 'rejected') throw new ApiError('Invalid response');

    const invRef = db().collection('invitations').doc(invitationId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) throw new ApiError('Invitation not found.', 404);
    const inv = invSnap.data()!;
    if (inv.targetUserId !== uid) throw new ApiError('This invitation is not addressed to you.', 403);
    if (inv.status !== 'pending') throw new ApiError('This invitation has already been responded to.');

    const isRequest = inv.type === 'request';
    const newMemberId: string = isRequest ? inv.senderId : inv.targetUserId;
    const regRef = db().collection('registrations').doc(inv.registrationId);

    if (response === 'rejected') {
        const batch = db().batch();
        batch.delete(invRef);
        if (isRequest) batch.update(regRef, { pendingRequests: FieldValue.arrayRemove(newMemberId) });
        await batch.commit();
        return;
    }

    if (await findRegistration(inv.eventId, newMemberId)) {
        throw new ApiError(isRequest ? 'This student has already joined another team.' : 'You are already registered for this event.');
    }
    const event = await getEvent(inv.eventId);
    const memberProfile = await db().collection('users').doc(newMemberId).get();

    await db().runTransaction(async (tx) => {
        const regSnap = await tx.get(regRef);
        if (!regSnap.exists) throw new ApiError('The team registration no longer exists.');
        const reg = regSnap.data()!;

        const members = reg.teamMembers || [];
        if (members.length + 2 > (event.maxTeamSize || 10)) throw new ApiError('This team is already full.');

        const teamMembers = [...members, {
            name: isRequest ? inv.senderName : inv.targetName,
            rollNo: memberProfile.data()?.rollNo || 'Unknown',
            userId: newMemberId,
        }];
        tx.update(regRef, {
            teamMembers,
            participantIds: FieldValue.arrayUnion(newMemberId),
            pendingRequests: FieldValue.arrayRemove(newMemberId),
            status: teamMembers.length + 1 >= (event.minTeamSize || 1) ? 'registered' : 'forming',
        });
        tx.update(invRef, { status: 'accepted', respondedAt: Timestamp.now() });
    });
}

async function availableTeams(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const event = await getEvent(eventId);
    const maxSize = event.maxTeamSize || 10;

    const snap = await db().collection('registrations').where('eventId', '==', eventId).get();
    const teams = snap.docs
        .map(d => d.data())
        .filter(t => t.teamName
            && 1 + (t.teamMembers?.length || 0) < maxSize
            && (t.pendingRequests?.length || 0) < maxSize
            && !t.participantIds?.includes(uid)
            && !t.pendingRequests?.includes(uid))
        // Only what the "Join a Team" list shows.
        .map(t => ({ id: t.id, teamName: t.teamName, leaderName: t.userDetails?.name || 'Unknown', memberCount: 1 + (t.teamMembers?.length || 0) }));
    return { teams };
}

async function requestJoin(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const registrationId = text(body, 'registrationId');

    const regRef = db().collection('registrations').doc(registrationId);
    const regSnap = await regRef.get();
    if (!regSnap.exists || regSnap.data()!.eventId !== eventId || !regSnap.data()!.teamName) {
        throw new ApiError('Team not found.', 404);
    }
    const team = regSnap.data()!;
    const event = await getEvent(eventId);
    const maxSize = event.maxTeamSize || 10;

    if (await findRegistration(eventId, uid)) throw new ApiError('You are already registered for this event.');
    if (team.pendingRequests?.includes(uid)) throw new ApiError('You have already requested to join this team.');
    if (1 + (team.teamMembers?.length || 0) >= maxSize) throw new ApiError('This team is already full.');
    if ((team.pendingRequests?.length || 0) >= maxSize) throw new ApiError('This team has too many pending requests.');

    const profile = await getProfile(uid);
    const inviteId = `${eventId}_${uid}_req_${registrationId}`;
    const batch = db().batch();
    batch.set(db().collection('invitations').doc(inviteId), {
        id: inviteId,
        eventId,
        eventTitle: event.title || '',
        teamName: team.teamName,
        registrationId,
        senderId: uid,
        senderName: profile.displayName || 'Unknown',
        targetUserId: team.userId,
        targetName: team.userDetails?.name || 'Team Leader',
        targetRollNo: team.userDetails?.rollNo || '',
        type: 'request',
        status: 'pending',
        createdAt: Timestamp.now(),
    });
    batch.update(regRef, { pendingRequests: FieldValue.arrayUnion(uid) });
    await batch.commit();
}

async function removeMember(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const leaderId = text(body, 'leaderId');
    const memberId = text(body, 'memberId');
    if (uid !== leaderId && uid !== memberId) throw new ApiError('Only the team leader can remove other members.', 403);
    if (memberId === leaderId) throw new ApiError('The leader cannot leave; delete the team instead.');

    const regRef = db().collection('registrations').doc(`${eventId}_${leaderId}`);
    const event = await getEvent(eventId);
    // Both invites (target = member) and join requests (sender = member) for this team.
    const invites = await db().collection('invitations').where('registrationId', '==', regRef.id).get();
    const memberInvites = invites.docs.filter(d => d.data().targetUserId === memberId || d.data().senderId === memberId);

    await db().runTransaction(async (tx) => {
        const regSnap = await tx.get(regRef);
        if (!regSnap.exists) throw new ApiError('Team not found', 404);
        const teamMembers = (regSnap.data()!.teamMembers || []).filter((m: { userId?: string }) => m.userId !== memberId);

        tx.update(regRef, {
            teamMembers,
            participantIds: FieldValue.arrayRemove(memberId),
            status: teamMembers.length + 1 >= (event.minTeamSize || 1) ? 'registered' : 'forming',
            [`attendance.${memberId}`]: FieldValue.delete(),
            [`feedbackMap.${memberId}`]: FieldValue.delete(),
        });
        memberInvites.forEach(d => tx.delete(d.ref));
    });
}

async function deleteTeam(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const regRef = db().collection('registrations').doc(`${eventId}_${uid}`);
    const invites = await db().collection('invitations').where('registrationId', '==', regRef.id).get();

    const batch = db().batch();
    batch.delete(regRef);
    invites.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
}

// Admin: remove any registration for an event, freeing a slot and promoting waitlisted.
async function removeRegistration(actorUid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const targetUid = text(body, 'targetUserId');

    const reg = await findRegistration(eventId, targetUid);
    if (!reg) throw new ApiError('No registration found for this user.', 404);

    const event = await getEvent(eventId);

    // Delete associated invitations (target = removed user)
    const invites = await db().collection('invitations').where('eventId', '==', eventId).where('targetUserId', '==', targetUid).get();
    const batch = db().batch();
    invites.docs.forEach(d => batch.delete(d.ref));
    batch.delete(reg.ref);
    await batch.commit();

    // Promote first waitlisted participant if slots are available
    if (event.enableWaitlist && event.maxParticipants) {
        const remaining = event.maxParticipants - await countParticipants(eventId);
        if (remaining > 0) {
            const waitlisted = await getWaitlisted(eventId);
            if (waitlisted.length > 0) {
                const first = waitlisted[0];
                await db().collection('registrations').doc(first.id).update({ status: 'registered' });
            }
        }
    }

    return { removed: targetUid };
}

// Student: unregister themselves from an event.
async function unregister(uid: string, body: Body) {
    const eventId = text(body, 'eventId');

    const reg = await findRegistration(eventId, uid);
    if (!reg) throw new ApiError('You are not registered for this event.', 404);

    const event = await getEvent(eventId);

    // Delete associated invitations where this user is the target
    const invites = await db().collection('invitations').where('eventId', '==', eventId).where('targetUserId', '==', uid).get();
    const batch = db().batch();
    invites.docs.forEach(d => batch.delete(d.ref));
    batch.delete(reg.ref);
    await batch.commit();

    // Promote first waitlisted if slots opened
    if (event.enableWaitlist && event.maxParticipants) {
        const remaining = event.maxParticipants - await countParticipants(eventId);
        if (remaining > 0) {
            const waitlisted = await getWaitlisted(eventId);
            if (waitlisted.length > 0) {
                const first = waitlisted[0];
                await db().collection('registrations').doc(first.id).update({ status: 'registered' });
            }
        }
    }

    return { unregistered: true };
}

async function checkin(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const code = text(body, 'code');
    const secretRef = db().collection('event_secrets').doc(eventId);

    const secret = await secretRef.get();
    if (!secret.exists || !secret.data()!.code) throw new ApiError('Attendance is not active for this event');
    if ((secret.data()!.failures?.[uid] || 0) >= MAX_CHECKIN_FAILURES) {
        throw new ApiError('Too many incorrect attempts. Ask an organiser to restart attendance.', 429);
    }
    if (code !== secret.data()!.code) {
        await secretRef.update({ [`failures.${uid}`]: FieldValue.increment(1) });
        throw new ApiError('Incorrect code. Please try again.', 403);
    }

    const sessionId = secret.data()!.sessionId;
    const reg = await findRegistration(eventId, uid);
    if (!reg) throw new ApiError('You are not registered for this event', 403);
    // Duplicate check-in prevention: block only if already checked in for THIS session.
    // A participant may check in again in a new session after a restart.
    if (reg.data.attendanceSession?.[uid] === sessionId) {
        throw new ApiError('You have already checked in for this session');
    }

    const attended = reg.data.status === 'attended' || !!reg.data.attendance?.[uid];
    await reg.ref.update(reg.data.teamName
        ? { [`attendance.${uid}`]: true, [`attendanceSession.${uid}`]: sessionId }
        : { status: attended ? reg.data.status : 'attended', [`attendance.${uid}`]: true, [`attendanceSession.${uid}`]: sessionId });

    // Persist a standalone attendance record for session-scoped exports and reset.
    const profile = await getProfile(uid);
    const recordRef = db().collection('attendance_records').doc();
    await recordRef.set({
        id: recordRef.id,
        eventId,
        userId: uid,
        userName: profile.displayName || reg.data.userDetails.name || 'Unknown',
        rollNo: profile.rollNo || reg.data.userDetails.rollNo || '',
        sessionId,
        code,
        teamName: reg.data.teamName ?? null,
        checkedInAt: Timestamp.now(),
    });
}

async function feedback(uid: string, body: Body) {
    const eventId = text(body, 'eventId');
    const event = await getEvent(eventId);
    if (!event.isFeedbackOpen && event.feedbackStatus !== 'active') throw new ApiError('Feedback is not open for this event.');

    const reg = await findRegistration(eventId, uid);
    if (!reg) throw new ApiError('You are not registered for this event', 403);
    if (reg.data.status !== 'attended' && !reg.data.attendance?.[uid]) throw new ApiError('Only attendees can give feedback.', 403);
    if (reg.data.feedbackMap?.[uid] || (!reg.data.feedbackMap && reg.data.feedbackSubmitted)) {
        throw new ApiError('You have already submitted feedback.');
    }

    const overallRating = rating(body.overallRating);
    const input = (body.matrixRatings ?? {}) as Record<string, unknown>;
    const matrixRatings = Object.fromEntries(FEEDBACK_KEYS.map(k => [k, rating(input[k])]));
    const opinion = text(body, 'opinion');
    if (opinion.length > 2000) throw new ApiError('Feedback must be under 2000 characters');
    const profile = await getProfile(uid);

    const eventRef = db().collection('events').doc(eventId);
    const feedbackRef = db().collection('feedbacks').doc();
    await db().runTransaction(async (tx) => {
        const current = (await tx.get(eventRef)).data() || {};
        const count = current.feedbackCount || 0;

        tx.set(feedbackRef, {
            id: feedbackRef.id,
            eventId,
            registrationId: reg.ref.id,
            userId: uid,
            userName: profile.displayName || 'Unknown',
            overallRating,
            matrixRatings,
            opinion,
            submittedAt: Timestamp.now(),
        });
        tx.update(reg.ref, { feedbackSubmitted: true, [`feedbackMap.${uid}`]: true });
        tx.update(eventRef, {
            avgRating: ((current.avgRating || 0) * count + overallRating) / (count + 1),
            feedbackCount: count + 1,
        });
    });
}

const ACTIONS: Record<string, (uid: string, body: Body) => Promise<unknown>> = {
    register, searchStudents, invite, respond, availableTeams, requestJoin, removeMember, deleteTeam, checkin, feedback,
    removeRegistration, unregister,
};

export async function POST(request: Request) {
    const auth = await verifyAuthToken(request);
    if (!auth) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

    try {
        const body = await request.json().catch(() => null);
        const action = body && typeof body.action === 'string' && Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : undefined;
        if (!action) throw new ApiError('Unknown action');

        // Rate limiting per action per user
        const rateLimitResult = await checkRateLimit(auth.uid, body.action!);

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                {
                    error: 'Too many requests. Please wait before trying again.',
                    retryAfterMs: rateLimitResult.retryAfterMs,
                },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetAt / 1000).toString(),
                        'Retry-After': Math.ceil((rateLimitResult.retryAfterMs ?? 0) / 1000).toString(),
                    },
                }
            );
        }

        const result = (await action(auth.uid, body)) ?? { success: true };
        return NextResponse.json(result, {
            headers: {
                'X-RateLimit-Limit': rateLimitResult.limit.toString(),
                'X-RateLimit-Remaining': Math.max(0, rateLimitResult.limit - rateLimitResult.currentCount).toString(),
                'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetAt / 1000).toString(),
            },
        });
    } catch (error) {
        if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('Registrations API error:', error);
        return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
}
