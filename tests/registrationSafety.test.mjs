// Regression tests for event registration safety:
//  - waitlisted registrations must not consume capacity
//  - admin registration removal must stay behind events.manage (it used to be
//    reachable by any signed-in student through the shared action table)
//  - a team member unregistering must not delete the whole team
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { countActiveParticipants } from '../src/lib/registrationCapacity.ts';

const route = readFileSync('./src/app/api/registrations/route.ts', 'utf8');

describe('registration capacity', () => {
    test('waitlisted registrations do not occupy a slot', () => {
        const registrations = [
            { status: 'registered', participantIds: ['u1'] },
            { status: 'attended', participantIds: ['u2'] },
            { status: 'waitlisted', participantIds: ['u3'] },
            { status: 'waitlisted', participantIds: ['u4'] },
        ];
        assert.strictEqual(countActiveParticipants(registrations), 2);
    });

    test('team registrations count every participant', () => {
        assert.strictEqual(countActiveParticipants([
            { status: 'registered', participantIds: ['leader', 'm1', 'm2'] },
        ]), 3);
    });

    test('legacy rows without participantIds count as one place', () => {
        assert.strictEqual(countActiveParticipants([
            { status: 'registered' },
            { status: 'waitlisted' },
        ]), 1);
    });

    test('empty capacity is zero', () => {
        assert.strictEqual(countActiveParticipants([]), 0);
    });
});

describe('admin-only registration removal', () => {
    test('the student action table does not expose removeRegistration', () => {
        const start = route.indexOf('const ACTIONS');
        assert.ok(start > -1, 'ACTIONS table exists');
        const table = route.slice(start, route.indexOf('};', start));
        assert.ok(!table.includes('removeRegistration'), 'removeRegistration must not be a student action');
    });

    test('removeRegistration requires events.manage from a verified admin context', () => {
        assert.ok(route.includes("actionName === 'removeRegistration'"), 'admin action is special-cased');
        assert.ok(route.includes('getAdminContext(request)'), 'caller is resolved server-side');
        assert.ok(route.includes("hasPermission(ctx, 'events.manage')"), 'events.manage is required');
        assert.ok(route.includes('registration.admin_remove'), 'removal is audited');
    });

    test('waitlist promotion uses active capacity, not raw registration count', () => {
        assert.ok(route.includes('countActiveParticipants'), 'uses the shared capacity helper');
        assert.ok(!route.includes('countParticipants'), 'the old waitlist-inclusive counter is gone');
    });
});

describe('team unregister semantics', () => {
    test('a non-leader team member leaves without deleting the team document', () => {
        assert.ok(route.includes('isTeam && !isLeader'), 'member path is distinguished');
        assert.ok(route.includes('leftTeam: true'), 'response reports a team leave');
        const memberPath = route.slice(route.indexOf('isTeam && !isLeader'), route.indexOf('// Individual or team leader'));
        assert.ok(memberPath.includes('arrayRemove(uid)'), 'only the member is removed');
        assert.ok(!memberPath.includes('batch.delete(reg.ref)'), 'team document is preserved');
    });
});
