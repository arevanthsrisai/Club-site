// Tests for the permission catalog, role model and student-field validation.
//
// These import the REAL TypeScript sources directly (Node 24 strips types
// natively), so the tests cover the same code the app runs — no mirrored
// copies. All three modules are dependency-free / ESM-safe on purpose.
import { test } from 'node:test';
import assert from 'node:assert';

import {
    PERMISSIONS, ALL_PERMISSION_IDS, LEGACY_ADMIN_PERMISSION_IDS,
    resolveRolePermissions, isValidPermissionId, permissionsByGroup, permissionSummary,
} from '../src/lib/permissions.ts';
import {
    withBuiltIns, roleIdFromLabel, DEFAULT_ROLES, DEFAULT_ROLE_ID, CTO_ROLE, EX_CORE_ROLE,
} from '../src/lib/roles.ts';
import { studentPatchSchema } from '../src/lib/studentFields.ts';

// ---------------------------------------------------------------- catalog

test('permission catalog: unique ids, groups, and descriptions present', () => {
    assert.ok(PERMISSIONS.length >= 8);
    const ids = new Set(PERMISSIONS.map(p => p.id));
    assert.strictEqual(ids.size, PERMISSIONS.length, 'permission ids must be unique');
    for (const p of PERMISSIONS) {
        assert.ok(p.id.length > 0);
        assert.ok(p.label.length > 0);
        assert.ok(p.description.length > 0);
        assert.ok(p.group.length > 0);
    }
    assert.deepStrictEqual(ALL_PERMISSION_IDS, PERMISSIONS.map(p => p.id));
});

test('every permission id belongs to one of the listed groups', () => {
    const groups = permissionsByGroup().map(g => g.group);
    for (const p of PERMISSIONS) assert.ok(groups.includes(p.group), `${p.id} group missing from view grouping`);
    // groups must partition the catalog
    const groupedTotal = permissionsByGroup().reduce((n, g) => n + g.items.length, 0);
    assert.strictEqual(groupedTotal, PERMISSIONS.length);
});

test('required permission groups exist', () => {
    const groups = permissionsByGroup().map(g => g.group);
    assert.ok(groups.includes('Student account management'));
    assert.ok(groups.includes('Event management'));
    assert.ok(groups.includes('Gallery and media'));
    assert.ok(groups.includes('Resource management'));
    assert.ok(groups.includes('Team, alumni and site settings'));
    assert.ok(groups.includes('Admin and role management'));
});

// ------------------------------------------------- resolveRolePermissions

test('CTO always resolves to every permission (protected invariant)', () => {
    const perms = resolveRolePermissions({ id: 'CTO', permissions: [] });
    assert.deepStrictEqual([...perms].sort(), [...ALL_PERMISSION_IDS].sort());
    // Even if a corrupted document tries to subtract them.
    assert.strictEqual(resolveRolePermissions({ id: 'CTO', permissions: [] }).length, ALL_PERMISSION_IDS.length);
});

test('Ex-Core Member always resolves to no permissions (protected invariant)', () => {
    // Even if a corrupted document tries to grant them.
    const perms = resolveRolePermissions({ id: 'ExCoreMember', permissions: [...ALL_PERMISSION_IDS] });
    assert.deepStrictEqual(perms, []);
});

test('legacy role without a permissions array keeps the pre-catalog authority', () => {
    const perms = resolveRolePermissions({ id: 'Activator' });
    assert.deepStrictEqual(perms, LEGACY_ADMIN_PERMISSION_IDS);
});

test('stored permissions are filtered to known catalog ids', () => {
    const perms = resolveRolePermissions({ id: 'Custom_Role', permissions: ['events.manage', 'bogus.unknown.id', 'gallery.manage'] });
    assert.deepStrictEqual(perms.sort(), ['events.manage', 'gallery.manage']);
    assert.ok(!perms.includes('bogus.unknown.id'), 'unknown ids must never be honored');
});

test('stored permissions are deduplicated', () => {
    const perms = resolveRolePermissions({ id: 'Custom_Role', permissions: ['events.manage', 'events.manage'] });
    assert.deepStrictEqual(perms, ['events.manage']);
});

test('a role can be drained to zero permissions (least privilege)', () => {
    const perms = resolveRolePermissions({ id: 'Custom_Role', permissions: [] });
    assert.deepStrictEqual(perms, []);
});

test('isValidPermissionId rejects non-strings and unknown ids', () => {
    assert.ok(isValidPermissionId('events.manage'));
    assert.ok(!isValidPermissionId('not.a.permission'));
    assert.ok(!isValidPermissionId(42));
    assert.ok(!isValidPermissionId(null));
});

test('revoking a permission from a role immediately affects effective access', () => {
    const before = resolveRolePermissions({ id: 'Custom_Role', permissions: [...LEGACY_ADMIN_PERMISSION_IDS] });
    assert.ok(before.includes('students.edit'));
    const after = resolveRolePermissions({
        id: 'Custom_Role',
        permissions: before.filter(p => p !== 'students.edit'),
    });
    assert.ok(!after.includes('students.edit'));
    assert.ok(after.includes('students.view'), 'other permissions survive the revocation');
});

// --------------------------------------------------------------- summary

test('permissionSummary shortens for the role overview', () => {
    assert.strictEqual(permissionSummary([]), 'No permissions');
    assert.strictEqual(permissionSummary(['events.manage']), 'Manage events');
    const many = permissionSummary(ALL_PERMISSION_IDS);
    assert.ok(many.includes('+'), `long lists summarize: ${many}`);
});

// ---------------------------------------------------------------- roles

test('withBuiltIns guarantees exactly one CTO entry and vertical order', () => {
    for (const stored of [[], DEFAULT_ROLES]) {
        const roles = withBuiltIns([...stored, { id: 'CTO', label: 'x', rank: 999, limit: 1 }]);
        const ctos = roles.filter(r => r.id === CTO_ROLE.id);
        assert.strictEqual(ctos.length, 1, 'CTO appears exactly once');
        for (let i = 1; i < roles.length; i++) {
            assert.ok(roles[i].rank >= roles[i - 1].rank, 'roles sorted by rank');
        }
    }
});

test('Activator default role is unlimited and survives every build', () => {
    const roles = withBuiltIns(DEFAULT_ROLES);
    const activator = roles.find(r => r.id === DEFAULT_ROLE_ID);
    assert.ok(activator);
    assert.strictEqual(activator.limit, null, 'default role must accept unlimited holders');
});

test('Ex-Core Member role is fixed in code and always present', () => {
    const roles = withBuiltIns(DEFAULT_ROLES);
    const exCore = roles.find(r => r.id === EX_CORE_ROLE.id);
    assert.ok(exCore, 'Ex-Core Member role must survive every build');
    assert.strictEqual(exCore.permissions?.length, 0);
    assert.strictEqual(exCore.limit, null);
    // Not stored in DEFAULT_ROLES, so it is added by withBuiltIns rather than seeded.
    assert.ok(!DEFAULT_ROLES.some(r => r.id === EX_CORE_ROLE.id), 'kept out of seeded defaults');
});

test('roleIdFromLabel sanitizes arbitrary role names', () => {
    assert.strictEqual(roleIdFromLabel('Events Lead'), 'Events_Lead');
    assert.strictEqual(roleIdFromLabel('  weird -- name!!  '), 'weird_name');
    assert.strictEqual(roleIdFromLabel(')*bad(*'), 'bad');
    assert.strictEqual(roleIdFromLabel('CTO'), 'CTO');
});

// ------------------------------------------------- student field validation

function issues(result) {
    if (result.success) return [];
    return result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
}

test('a valid student profile patch parses fully', () => {
    const parsed = studentPatchSchema.safeParse({
        uid: 'u123',
        data: {
            displayName: 'Test Student',
            email: 'Student@Example.COM',
            rollNo: 'AM.EN.U4AIML22045',
            class: 'CSE AIML',
            section: 'B',
            mobile: '+91 98765-43210',
            hosteller: false,
            isVerified: true,
        },
    });
    assert.ok(parsed.success);
    assert.strictEqual(parsed.data.data.email, 'student@example.com', 'email normalized to lowercase');
});

test('mass assignment is rejected: role/admin fields are not patchable', () => {
    const parsed = studentPatchSchema.safeParse({
        uid: 'u123',
        data: { displayName: 'Evil', role: 'CTO' },
    });
    assert.ok(!parsed.success, 'unknown fields must be rejected by strict()');
    const parsed2 = studentPatchSchema.safeParse({
        uid: 'u123',
        data: { displayName: 'Evil', isAdmin: true },
    });
    assert.ok(!parsed2.success);
    const parsed3 = studentPatchSchema.safeParse({
        uid: 'u123',
        data: { displayName: 'Evil', uid: 'other-uid' },
    });
    assert.ok(!parsed3.success, 'uid cannot be redirected via the data payload');
});

test('email validation: malformed addresses rejected, limits enforced', () => {
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { email: 'not-an-email' } }).success);
    const long = { uid: 'u', data: { email: `${'x'.repeat(200)}@a.com` } };
    assert.ok(!studentPatchSchema.safeParse(long).success);
});

test('field length limits are enforced per field', () => {
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { displayName: 'x'.repeat(61) } }).success);
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { rollNo: 'x'.repeat(31) } }).success);
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { class: 'x'.repeat(31) } }).success);
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { section: 'x'.repeat(11) } }).success);
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { mobile: 'x'.repeat(16) } }).success);
    assert.ok(!studentPatchSchema.safeParse({ uid: '', data: { displayName: 'ok' } }).success, 'uid required');
});

test('mobile numbers accept only digits, spaces, hyphens and a leading plus', () => {
    assert.ok(studentPatchSchema.safeParse({ uid: 'u', data: { mobile: '+91-98765 43210' } }).success);
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { mobile: 'call 098765' } }).success, 'letters rejected');
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { mobile: '(098)7654321' } }).success, 'parentheses rejected');
});

test('boolean announce fields must be booleans', () => {
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { hosteller: 'yes' } }).success);
    assert.ok(!studentPatchSchema.safeParse({ uid: 'u', data: { isVerified: 1 } }).success);
    assert.ok(studentPatchSchema.safeParse({ uid: 'u', data: { hosteller: true, isVerified: false } }).success);
});

test('an empty edit produces no fields rather than wiping data', () => {
    const parsed = studentPatchSchema.safeParse({ uid: 'u', data: {} });
    assert.ok(parsed.success, 'empty data object is schema-valid');
    const entries = Object.entries(parsed.data.data).filter(([, v]) => v !== undefined);
    assert.strictEqual(entries.length, 0, 'no accidental field overwrites from an empty edit');
});

// --------------------------------------------- errors are human-readable

test('validation failures carry field-specific messages', () => {
    const result = studentPatchSchema.safeParse({ uid: 'u', data: { displayName: 'x'.repeat(61) } });
    const errs = issues(result);
    assert.ok(errs.some(e => e.message.includes('under 60')), JSON.stringify(errs));
});
