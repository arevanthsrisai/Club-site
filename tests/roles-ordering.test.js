// Regression tests for canonical role precedence and member ordering
// (src/lib/roles.ts — pure logic used by /admin/admins, /admin/team, /about).
const { test } = require('node:test');
const assert = require('node:assert');
const { sortMembersByRole, reorderRoles, withBuiltIns, DEFAULT_ROLES, DEFAULT_ROLE_ID } = require('../src/lib/roles.ts');

test('sortMembersByRole orders by role rank first, then stable member order', () => {
    const roles = withBuiltIns(DEFAULT_ROLES);
    const uid = (n) => `uid-${n}`;
    const members = [
        { uid: uid(1), role: 'Activator', displayName: 'Zoe' },
        { uid: uid(2), role: 'President', displayName: 'Alice' },
        { uid: uid(3), role: 'Activator', displayName: 'Bob' },
        { uid: uid(4), role: 'Mentor', displayName: 'Mia' },
        { uid: uid(5), role: 'President', displayName: 'Ben' },
        { uid: uid(6), role: 'Activator', displayName: 'Ann' },
    ];
    const sorted = sortMembersByRole(members, roles);
    const byName = sorted.map(m => m.displayName);
    // President (rank 3): Alice < Ben; Mentor (rank 2) Mia before President…,
    // Activator (99) last with stable name order Ann, Bob, Zoe
    assert.deepStrictEqual(byName, ['Mia', 'Alice', 'Ben', 'Ann', 'Bob', 'Zoe']);
});

test('sortMembersByRole falls back to uid when displayName missing and is stable across runs', () => {
    const roles = withBuiltIns(DEFAULT_ROLES);
    const members = [
        { uid: 'b-uid', role: 'Activator' },
        { uid: 'a-uid', role: 'Activator' },
        { uid: 'c-uid', role: 'Activator', displayName: 'Carl' },
    ];
    const once = sortMembersByRole(members, roles).map(m => m.uid);
    const twice = sortMembersByRole(members, roles).map(m => m.uid);
    assert.deepStrictEqual(once, ['a-uid', 'b-uid', 'c-uid']);
    assert.deepStrictEqual(once, twice, 'same input must give the same order');
});

test('reorderRoles produces contiguous ranks with drag-to-target semantics', () => {
    const roles = withBuiltIns(DEFAULT_ROLES);
    const treasurer = roles.find(r => r.id === 'Treasurer');   // rank 8, last
    const faculty = roles.find(r => r.id === 'Faculty');       // rank 1, first
    const moved = reorderRoles(roles, treasurer.id, faculty.id);
    const ranks = moved.map(r => r.rank);
    // Ranks renumbered 10, 20, 30, …
    assert.deepStrictEqual(ranks, moved.map((_, i) => (i + 1) * 10));
    assert.strictEqual(moved[0].id, 'Treasurer', 'dragged role lands on the target position');
    // Faculty follows right after
    assert.strictEqual(moved[1].id, 'Faculty');
});

test('reorderRoles is a no-op when dragging onto itself and never touches Activator identity', () => {
    const roles = withBuiltIns(DEFAULT_ROLES);
    assert.deepStrictEqual(reorderRoles(roles, DEFAULT_ROLE_ID, DEFAULT_ROLE_ID), roles);
    const moved = reorderRoles(roles, 'Faculty', 'Mentor');
    assert.ok(moved.some(r => r.id === DEFAULT_ROLE_ID), 'Activator role must survive a reorder');
});

test('reorderRoles keeps the CTO role present after a reorder', () => {
    const roles = withBuiltIns(DEFAULT_ROLES);
    const moved = reorderRoles(roles, 'Faculty', 'Treasurer');
    assert.ok(moved.some(r => r.id === 'CTO'), 'CTO must remain in the ordering');
});
