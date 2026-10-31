// Rate limiting tests
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { checkRateLimit, resetRateLimit, store, DEFAULT_RATE_LIMITS } from '../src/lib/rateLimit.ts';

const TEST_UID = 'test-user-rate-limit';

before(async () => {
    // Clean up any existing test data
    for (const action of Object.keys(DEFAULT_RATE_LIMITS)) {
        await resetRateLimit(TEST_UID, action);
    }
});

after(async () => {
    // Clean up after tests
    for (const action of Object.keys(DEFAULT_RATE_LIMITS)) {
        await resetRateLimit(TEST_UID, action);
    }
});

test('rate limit allows requests within limit', async () => {
    const result = await checkRateLimit(TEST_UID, 'searchStudents');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 1);
    assert.strictEqual(result.limit, DEFAULT_RATE_LIMITS.searchStudents.max);
});

test('rate limit tracks multiple requests', async () => {
    await resetRateLimit(TEST_UID, 'searchStudents');
    await checkRateLimit(TEST_UID, 'searchStudents');
    const result = await checkRateLimit(TEST_UID, 'searchStudents');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 2);
});

test('rate limit blocks when limit exceeded', async () => {
    // searchStudents limit is 30 per minute
    for (let i = 0; i < 30; i++) {
        await checkRateLimit(TEST_UID, 'searchStudents');
    }
    const result = await checkRateLimit(TEST_UID, 'searchStudents');
    assert.strictEqual(result.allowed, false);
    assert.ok(result.retryAfterMs !== undefined);
    assert.ok(result.retryAfterMs > 0);
});

test('different actions have independent limits', async () => {
    // Exhaust search limit
    for (let i = 0; i < 30; i++) {
        await checkRateLimit(TEST_UID, 'searchStudents');
    }
    // But invite should still work (different limit)
    const inviteResult = await checkRateLimit(TEST_UID, 'invite');
    assert.strictEqual(inviteResult.allowed, true);
});

test('different users have independent limits', async () => {
    // Exhaust limit for user A
    for (let i = 0; i < 30; i++) {
        await checkRateLimit('user-a', 'searchStudents');
    }
    // User B should still work
    const result = await checkRateLimit('user-b', 'searchStudents');
    assert.strictEqual(result.allowed, true);
});

test('rate limit reset clears the bucket', async () => {
    // Exhaust limit
    for (let i = 0; i < 30; i++) {
        await checkRateLimit(TEST_UID, 'searchStudents');
    }
    let result = await checkRateLimit(TEST_UID, 'searchStudents');
    assert.strictEqual(result.allowed, false);

    // Reset
    await resetRateLimit(TEST_UID, 'searchStudents');
    result = await checkRateLimit(TEST_UID, 'searchStudents');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 1);
});

test('unknown action returns allowed', async () => {
    const result = await checkRateLimit(TEST_UID, 'unknownAction');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.limit, Infinity);
});

test('checkin has correct limit', async () => {
    const config = DEFAULT_RATE_LIMITS.checkin;
    assert.strictEqual(config.max, 5);
    assert.strictEqual(config.windowMs, 10 * 60 * 1000);
});

test('feedback has correct limit', async () => {
    const config = DEFAULT_RATE_LIMITS.feedback;
    assert.strictEqual(config.max, 2);
    assert.strictEqual(config.windowMs, 5 * 60 * 1000);
});

test('register has correct limit', async () => {
    const config = DEFAULT_RATE_LIMITS.register;
    assert.strictEqual(config.max, 3);
    assert.strictEqual(config.windowMs, 10 * 60 * 1000);
});