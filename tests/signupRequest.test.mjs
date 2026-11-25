// Regression tests for admin signup request handling.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert';

import { isPendingSignup, PENDING_SIGNUP_ROLE } from '../src/lib/signupRequest.ts';

test('a signup request is actionable only while the account is pending', () => {
    assert.strictEqual(PENDING_SIGNUP_ROLE, 'pending');
    assert.strictEqual(isPendingSignup('pending'), true);
    // No admin profile yet: an orphaned Auth account with only a request
    // record stays recoverable through Approve.
    assert.strictEqual(isPendingSignup(undefined), true);
    assert.strictEqual(isPendingSignup(null), true);
});

test('approved, active and Ex-Core accounts can never be re-approved or deleted by a stale request', () => {
    for (const role of ['Activator', 'CTO', 'President', 'onboarding', 'ExCoreMember', '']) {
        assert.strictEqual(isPendingSignup(role), false, `${role || 'empty'} must not be treated as pending`);
    }
});

test('finishing signup as Ex-Core ends the pending request', () => {
    // The onboarding role route sets ExCoreMember; approve/reject and the CTO
    // pending list all pass the account's current role through this check.
    const roleAfterExCoreOnboarding = 'ExCoreMember';
    assert.strictEqual(isPendingSignup(roleAfterExCoreOnboarding), false);
});
