// Regression tests for privileged-route authorization and security headers.
//
// These routes used to trust `admins/{uid}.role === "CTO"` directly from a raw
// token check, which kept deactivated and Ex-Core accounts privileged. They now
// resolve the caller through serverAuthz (status + Ex-Core aware).
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { safeHttpUrl, safePhotoUrl } from '../src/lib/publicUrl.ts';

const read = (path) => readFileSync(path, 'utf8');

const createAdmin = read('./src/app/api/admin/create-admin/route.ts');
const deleteAdmin = read('./src/app/api/admin/delete-admin/route.ts');
const deleteUser = read('./src/app/api/admin/delete-user/route.ts');
const sendEmail = read('./src/app/api/send-email/route.ts');
const proxy = read('./src/proxy.ts');
const nextConfig = read('./next.config.mjs');

describe('CTO-only routes resolve the caller through serverAuthz', () => {
    for (const [name, source] of [
        ['create-admin', createAdmin],
        ['delete-admin', deleteAdmin],
        ['send-email', sendEmail],
    ]) {
        test(`${name} requires an active CTO context`, () => {
            assert.ok(source.includes('getAdminContext(request)'), 'uses the shared authorization layer');
            assert.ok(source.includes('ctx.isCTO'), 'requires the CTO invariant');
            assert.ok(!source.includes("data()?.role !== 'CTO'"), 'does not trust a raw role string');
        });
    }

    test('delete-user allows self-deletion and requires CTO for other accounts', () => {
        assert.ok(deleteUser.includes('verifyAuthToken(request)'), 'self path still proves identity from the token');
        assert.ok(deleteUser.includes('const isSelf = targetUid === authResult.uid'), 'self-deletion is explicit');
        assert.ok(deleteUser.includes('if (!isSelf)'), 'other accounts take the privileged path');
        assert.ok(deleteUser.includes('ctx.isCTO'), 'deleting another account is CTO-only');
        assert.ok(deleteUser.includes('DELETE_OWN_ACCOUNT'), 'self-deletion is audited');
    });
});

describe('global security headers', () => {
    test('pages cannot be framed and forms stay same-origin', () => {
        assert.ok(proxy.includes("frame-ancestors 'none'"), 'CSP blocks framing');
        assert.ok(proxy.includes("form-action 'self'"), 'CSP restricts form targets');
        assert.ok(nextConfig.includes("value: 'DENY'"), 'legacy clickjacking header present');
    });

    test('responses set HSTS, nosniff, referrer and permissions policy once', () => {
        assert.ok(nextConfig.includes('Strict-Transport-Security'), 'HSTS present');
        assert.ok(nextConfig.includes('X-Content-Type-Options'), 'MIME sniffing blocked');
        assert.ok(nextConfig.includes('Referrer-Policy'), 'referrer limited');
        assert.ok(nextConfig.includes('Permissions-Policy'), 'sensitive browser APIs disabled');
        assert.ok(nextConfig.includes("value: 'DENY'"), 'framing denied');
        assert.ok(!proxy.includes('X-Frame-Options'), 'proxy does not duplicate frame headers');
    });
});

describe('photo URL boundary', () => {
    test('same-origin paths are accepted', () => {
        assert.strictEqual(safePhotoUrl('/api/images/abc12345'), '/api/images/abc12345');
        assert.strictEqual(safePhotoUrl('https://example.com/a.png'), 'https://example.com/a.png');
    });

    test('protocol-relative and traversal-ish values are rejected', () => {
        assert.strictEqual(safePhotoUrl('//evil.example/a.png'), null);
        assert.strictEqual(safePhotoUrl('/\\evil.example'), null);
        assert.strictEqual(safePhotoUrl('javascript:alert(1)'), null);
        assert.strictEqual(safePhotoUrl(''), null);
    });

    test('safeHttpUrl only permits http(s)', () => {
        assert.ok(safeHttpUrl('https://example.com'));
        assert.strictEqual(safeHttpUrl('javascript:alert(1)'), null);
        assert.strictEqual(safeHttpUrl('data:text/html,x'), null);
    });
});
