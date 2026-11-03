// Security rules tests. Run with `npm run test:rules` (starts the Firestore and Storage emulators).
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';

let env;
const fs = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const png = new Uint8Array([137, 80, 78, 71]);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-relu',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins/cto'), { uid: 'cto', role: 'CTO', status: 'active' });
    await setDoc(doc(db, 'admins/act'), { uid: 'act', role: 'Activator', status: 'active' });
    await setDoc(doc(db, 'admins/onb'), { uid: 'onb', role: 'Activator', status: 'onboarding' });
    await setDoc(doc(db, 'admins/pend'), { uid: 'pend', role: 'pending' });
    await setDoc(doc(db, 'admins/lead'), { uid: 'lead', role: 'Events_Lead', status: 'active' });
    await setDoc(doc(db, 'users/s1'), { uid: 's1', mobile: '9999999999' });
    await setDoc(doc(db, 'users/s2'), { uid: 's2', mobile: '8888888888' });
    await setDoc(doc(db, 'events/e1'), { title: 'E1', registrationStatus: 'open' });
    await setDoc(doc(db, 'forms/f_pub'), { title: 'Public Form', status: 'published', fields: [] });
    await setDoc(doc(db, 'forms/f_draft'), { title: 'Draft Form', status: 'draft', fields: [] });
    await setDoc(doc(db, 'form_submissions/fp_stu'), { formId: 'f_pub', answers: { a: 'x' }, userName: 'Stu', userEmail: 's@example.com' });
    await setDoc(doc(db, 'event_secrets/e1'), { code: '1234' });
    await setDoc(doc(db, 'registrations/e1_s1'), { eventId: 'e1', userId: 's1', participantIds: ['s1', 's3'], status: 'registered' });
    await setDoc(doc(db, 'invitations/e1_s3'), { eventId: 'e1', targetUserId: 's3', senderId: 's1', registrationId: 'e1_s1', status: 'pending' });
    await setDoc(doc(db, 'feedbacks/f1'), { userId: 's1', eventId: 'e1' });
    await ctx.storage().ref('events/existing.png').put(png, { contentType: 'image/png' });
  });
});

after(async () => { if (env) await env.cleanup(); });

test('admin escalation is blocked', async () => {
  await assertFails(updateDoc(doc(fs('act'), 'admins/act'), { role: 'CTO' }));
  await assertFails(updateDoc(doc(fs('act'), 'admins/onb'), { role: 'President' }));
  await assertFails(updateDoc(doc(fs('onb'), 'admins/onb'), { role: 'CTO', status: 'active' }));
  await assertFails(updateDoc(doc(fs('act'), 'admins/act'), { approvedAt: Timestamp.now() }));
  await assertFails(updateDoc(doc(fs('act'), 'admins/act'), { status: 'onboarding' }));
  await assertSucceeds(updateDoc(doc(fs('cto'), 'admins/act'), { role: 'Mentor' }));
  await assertSucceeds(updateDoc(doc(fs('onb'), 'admins/onb'), { status: 'active', displayName: 'X', socials: {} }));
  await assertSucceeds(updateDoc(doc(fs('act'), 'admins/act'), { displayName: 'Y', photoURL: null }));
});

test('custom roles count as admins, pending does not', async () => {
  await assertSucceeds(updateDoc(doc(fs('lead'), 'events/e1'), { title: 'E1' }));
  await assertSucceeds(uploadBytes(ref(st('lead'), 'gallery/x.png'), png, { contentType: 'image/png' }));
  await assertFails(updateDoc(doc(fs('pend'), 'events/e1'), { title: 'E1' }));
  await assertFails(uploadBytes(ref(st('pend'), 'gallery/y.png'), png, { contentType: 'image/png' }));
  await assertFails(updateDoc(doc(fs('s1'), 'events/e1'), { title: 'E1' }));
});

test('club roles: public read, CTO write', async () => {
  await assertSucceeds(getDoc(doc(fs(null), 'club_roles/President')));
  await assertSucceeds(setDoc(doc(fs('cto'), 'club_roles/Events_Lead'), { label: 'Events Lead', rank: 10, limit: 2 }));
  await assertFails(setDoc(doc(fs('act'), 'club_roles/Events_Lead'), { label: 'Hacked', rank: 0, limit: null }));
  await assertFails(setDoc(doc(fs('lead'), 'club_roles/X'), { label: 'X', rank: 0, limit: 1 }));
  await assertFails(setDoc(doc(fs('s1'), 'club_roles/X'), { label: 'X', rank: 0, limit: 1 }));
});

test('admin self-signup only as pending', async () => {
  await assertSucceeds(setDoc(doc(fs('new1'), 'admins/new1'), { uid: 'new1', email: 'a@b', role: 'pending', createdAt: Timestamp.now() }));
  await assertFails(setDoc(doc(fs('new2'), 'admins/new2'), { uid: 'new2', email: 'a@b', role: 'CTO', createdAt: Timestamp.now() }));
  await assertFails(setDoc(doc(fs('new3'), 'admins/new3'), { uid: 'new3', email: 'a@b', role: 'pending', status: 'active', createdAt: Timestamp.now() }));
  await assertFails(updateDoc(doc(fs('pend'), 'admins/pend'), { role: 'Activator' }));
});

test('admin profiles are not exposed to students or pending admins', async () => {
  await assertFails(getDocs(collection(fs('s2'), 'admins')));
  await assertFails(getDocs(collection(fs('pend'), 'admins')));
  await assertFails(getDoc(doc(fs('s2'), 'admins/cto')));
  await assertSucceeds(getDoc(doc(fs('s2'), 'admins/s2')));
  await assertSucceeds(getDocs(collection(fs('act'), 'admins')));
});

test('attendance code is admin-only', async () => {
  await assertSucceeds(getDoc(doc(fs(null), 'events/e1')));
  await assertFails(getDoc(doc(fs('s1'), 'event_secrets/e1')));
  await assertFails(getDoc(doc(fs(null), 'event_secrets/e1')));
  await assertSucceeds(getDoc(doc(fs('act'), 'event_secrets/e1')));
  await assertFails(updateDoc(doc(fs('s1'), 'events/e1'), { avgRating: 5 }));
});

test('registrations: participants only, no student writes', async () => {
  await assertFails(getDoc(doc(fs('s2'), 'registrations/e1_s1')));
  await assertSucceeds(getDoc(doc(fs('s3'), 'registrations/e1_s1')));
  await assertSucceeds(getDoc(doc(fs('s2'), 'registrations/e1_s2')));
  await assertSucceeds(getDocs(query(collection(fs('s3'), 'registrations'), where('eventId', '==', 'e1'), where('participantIds', 'array-contains', 's3'))));
  await assertFails(getDocs(query(collection(fs('s2'), 'registrations'), where('eventId', '==', 'e1'))));
  await assertFails(updateDoc(doc(fs('s1'), 'registrations/e1_s1'), { status: 'attended' }));
  await assertFails(setDoc(doc(fs('s2'), 'registrations/e1_s2'), { eventId: 'e1', userId: 's2', participantIds: ['s2'] }));
  await assertSucceeds(getDocs(query(collection(fs('act'), 'registrations'), where('eventId', '==', 'e1'))));
  await assertSucceeds(updateDoc(doc(fs('act'), 'registrations/e1_s1'), { status: 'attended' }));
});

test('feedback, invitations, users', async () => {
  await assertFails(addDoc(collection(fs('s1'), 'feedbacks'), { userId: 's1', eventId: 'e1' }));
  await assertSucceeds(getDoc(doc(fs('s1'), 'feedbacks/f1')));
  await assertFails(getDoc(doc(fs('s2'), 'feedbacks/f1')));
  await assertSucceeds(getDocs(query(collection(fs('s1'), 'invitations'), where('registrationId', '==', 'e1_s1'))));
  await assertFails(setDoc(doc(fs('s1'), 'invitations/e1_s2'), { status: 'pending' }));
  await assertFails(getDoc(doc(fs('s2'), 'users/s1')));
  await assertFails(getDocs(collection(fs('s2'), 'users')));
  await assertSucceeds(getDoc(doc(fs('act'), 'users/s1')));
  await assertSucceeds(updateDoc(doc(fs('s2'), 'users/s2'), { displayName: 'S2' }));
  await assertSucceeds(deleteDoc(doc(fs('s2'), 'users/s2')));
});

test('audit logs and messages', async () => {
  await assertFails(addDoc(collection(fs('s1'), 'audit_logs'), { actorUid: 's1', action: 'x' }));
  await assertFails(addDoc(collection(fs('act'), 'audit_logs'), { actorUid: 'cto', action: 'x' }));
  await assertSucceeds(addDoc(collection(fs('act'), 'audit_logs'), { actorUid: 'act', action: 'x' }));
  await assertSucceeds(addDoc(collection(fs(null), 'messages'), { name: 'n', email: 'e@x', subject: 's', message: 'm', timestamp: Timestamp.now() }));
  await assertFails(addDoc(collection(fs(null), 'messages'), { name: 'n', email: 'e@x', subject: 's', message: 'm', timestamp: Timestamp.now(), extra: 1 }));
});

test('message workflow: solved flag and reminders are admin-only', async () => {
  // Reset fixture: earlier tests (admin escalation) legitimately flip onb to active,
  // so restore the onboarding state before asserting onboarding admins are blocked.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'admins/onb'), { uid: 'onb', role: 'Activator', status: 'onboarding' });
  });
  // Anyone can send a message; the admin can then toggle solved and set a reminder.
  const msgRef = doc(fs(null), 'messages/m1');
  await assertSucceeds(setDoc(msgRef, { name: 'n', email: 'e@x', subject: 's', message: 'm', timestamp: Timestamp.now() }));

  // Admin toggles solved + solvedAt
  await assertSucceeds(updateDoc(doc(fs('act'), 'messages/m1'), { solved: true, solvedAt: Timestamp.now() }));
  // Admin clears solved
  await assertSucceeds(updateDoc(doc(fs('act'), 'messages/m1'), { solved: false, solvedAt: null }));
  // Admin sets a follow-up reminder
  await assertSucceeds(updateDoc(doc(fs('act'), 'messages/m1'), { reminderAt: Timestamp.fromDate(new Date(Date.now() + 86400000)) }));
  // Admin clears the reminder
  await assertSucceeds(updateDoc(doc(fs('act'), 'messages/m1'), { reminderAt: null }));

  // Only the solved/solvedAt/reminderAt keys may change
  await assertFails(updateDoc(doc(fs('act'), 'messages/m1'), { subject: 'hacked' }));
  await assertFails(updateDoc(doc(fs('act'), 'messages/m1'), { solved: 'yes' }));
  await assertFails(updateDoc(doc(fs('act'), 'messages/m1'), { solvedAt: 'not-a-timestamp' }));
  await assertFails(updateDoc(doc(fs('act'), 'messages/m1'), { reminderAt: 123 }));

  // Non-admins cannot change the workflow state
  await assertFails(updateDoc(doc(fs('s1'), 'messages/m1'), { solved: true }));
  await assertFails(updateDoc(doc(fs('onb'), 'messages/m1'), { reminderAt: Timestamp.now() }));
});

test('ex-core profiles: public read, CTO-only client writes, others blocked', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'ex_core_members/m1'), { name: 'Old', memberType: 'core', roleHistory: [{ startYear: 2026, endYear: 2027, role: 'CTO' }], displayOrder: 0 });
  });
  // Anyone — even signed out — can read the public profiles.
  await assertSucceeds(getDoc(doc(fs(null), 'ex_core_members/m1')));
  await assertSucceeds(getDocs(collection(fs('s1'), 'ex_core_members')));
  // All client writes go through /api/ex-core (Admin SDK). Direct writes are
  // CTO-only; students and ordinary admins are denied.
  await assertFails(updateDoc(doc(fs('s1'), 'ex_core_members/m1'), { name: 'Hacked' }));
  await assertFails(setDoc(doc(fs('s1'), 'ex_core_members/m2'), { name: 'S' }));
  await assertFails(updateDoc(doc(fs('act'), 'ex_core_members/m1'), { name: 'Hacked' }));
  await assertFails(deleteDoc(doc(fs('act'), 'ex_core_members/m1')));
  await assertSucceeds(setDoc(doc(fs('cto'), 'ex_core_members/m2'), { name: 'CTO made me', memberType: 'activator', roleHistory: [{ startYear: 2027, endYear: 2028, role: 'CTO' }], displayOrder: 0 }));
  await assertSucceeds(updateDoc(doc(fs('cto'), 'ex_core_members/m1'), { name: 'Old' }));
  await assertSucceeds(deleteDoc(doc(fs('cto'), 'ex_core_members/m2')));
});

test('forms: published public read, draft admin-only, no client writes', async () => {
  await assertSucceeds(getDoc(doc(fs(null), 'forms/f_pub')));
  await assertSucceeds(getDoc(doc(fs('s1'), 'forms/f_pub')));
  await assertFails(getDoc(doc(fs(null), 'forms/f_draft')));
  await assertFails(getDoc(doc(fs('s1'), 'forms/f_draft')));
  // Submissions contain personal data — admins only.
  await assertFails(getDoc(doc(fs('s1'), 'form_submissions/fp_stu')));
  await assertFails(getDocs(collection(fs('s1'), 'form_submissions')));
  await assertSucceeds(getDoc(doc(fs('act'), 'form_submissions/fp_stu')));
  await assertSucceeds(getDoc(doc(fs('act'), 'forms/f_draft')));
  // Every write goes through the server API (Admin SDK) — clients are denied.
  await assertFails(setDoc(doc(fs('cto'), 'forms/f_new'), { title: 'X', status: 'draft' }));
  await assertFails(updateDoc(doc(fs('cto'), 'forms/f_pub'), { status: 'closed' }));
  await assertFails(deleteDoc(doc(fs('cto'), 'forms/f_pub')));
  await assertFails(setDoc(doc(fs('s1'), 'form_submissions/x1'), { answers: {} }));
});

test('storage writes are admin-only except own avatar', async () => {
  await assertFails(uploadBytes(ref(st('s1'), 'events/x.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(st('s1'), 'gallery/e1/x.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(st('pend'), 'team_profiles/x.png'), png, { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(ref(st('act'), 'events/x.png'), png, { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(ref(st('onb'), 'team_profiles/x.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(st('act'), 'events/x.pdf'), png, { contentType: 'application/pdf' }));
  await assertFails(deleteObject(ref(st('s1'), 'events/existing.png')));
  await assertSucceeds(deleteObject(ref(st('act'), 'events/existing.png')));
  await assertSucceeds(uploadBytes(ref(st('s1'), 'avatars/s1/a.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(st('s1'), 'avatars/s2/a.png'), png, { contentType: 'image/png' }));
});
