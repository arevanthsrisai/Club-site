// Regression tests for Ex-Core role, permissions, and profile sync.
import { test } from 'node:test';
import assert from 'node:assert';

import { EX_CORE_ROLE } from '../src/lib/roles.ts';
import { resolveRolePermissions, ALL_PERMISSION_IDS } from '../src/lib/permissions.ts';

test('Ex-Core Member role is fixed in code with zero permissions', () => {
    assert.strictEqual(EX_CORE_ROLE.id, 'ExCoreMember');
    assert.deepStrictEqual(EX_CORE_ROLE.permissions, []);
    assert.strictEqual(EX_CORE_ROLE.limit, null);
});

test('Ex-Core Member resolves to no permissions even with stale stored permissions', () => {
    const perms = resolveRolePermissions({ id: 'ExCoreMember', permissions: [...ALL_PERMISSION_IDS] });
    assert.deepStrictEqual(perms, []);
});

test('Ex-Core Member cannot gain Activator-level permissions', () => {
    const exCorePerms = resolveRolePermissions({ id: 'ExCoreMember' });
    const activatorPerms = resolveRolePermissions({ id: 'Activator' });
    for (const p of exCorePerms) {
        assert.ok(!activatorPerms.includes(p), 'Ex-Core must not inherit Activator permissions');
    }
    assert.strictEqual(exCorePerms.length, 0);
});

test('Ex-Core Member role has no permissions even when Firestore document is missing', () => {
    // Simulate a scenario where club_roles/ExCoreMember doesn't exist in Firestore
    // The role is fixed in code, so it should still resolve to zero permissions
    const perms = resolveRolePermissions({ id: 'ExCoreMember' });
    assert.deepStrictEqual(perms, []);
});
