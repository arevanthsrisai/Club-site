// Regression tests for form availability.
//
// Stored schedule values arrive from the Admin SDK as Firestore Timestamp
// objects. `new Date(timestamp)` is Invalid Date, so every window comparison
// was false and a published form ignored its opensAt/closesAt values.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { computeAvailability, toDateOrNull } from '../src/lib/forms.ts';

const submitRoute = readFileSync('./src/app/api/forms/submit/route.ts', 'utf8');

describe('toDateOrNull', () => {
    test('accepts Firestore Timestamp objects (Admin SDK)', () => {
        const date = new Date('2026-05-04T10:00:00.000Z');
        assert.strictEqual(toDateOrNull({ toDate: () => date })?.toISOString(), date.toISOString());
    });

    test('accepts serialized timestamp seconds', () => {
        const seconds = Math.floor(Date.UTC(2026, 4, 4, 10) / 1000);
        assert.strictEqual(toDateOrNull({ seconds })?.toISOString(), '2026-05-04T10:00:00.000Z');
        assert.strictEqual(toDateOrNull({ _seconds: seconds })?.toISOString(), '2026-05-04T10:00:00.000Z');
    });

    test('accepts Date, ISO strings and numbers', () => {
        assert.ok(toDateOrNull(new Date('2026-05-04T10:00:00.000Z')));
        assert.ok(toDateOrNull('2026-05-04T10:00:00.000Z'));
        assert.ok(toDateOrNull(Date.UTC(2026, 4, 4, 10)));
    });

    test('rejects empty, malformed and invalid values instead of inventing a date', () => {
        assert.strictEqual(toDateOrNull(null), null);
        assert.strictEqual(toDateOrNull(undefined), null);
        assert.strictEqual(toDateOrNull(''), null);
        assert.strictEqual(toDateOrNull('not-a-date'), null);
        assert.strictEqual(toDateOrNull({}), null);
        assert.strictEqual(toDateOrNull(new Date('nope')), null);
    });
});

describe('form availability windows', () => {
    const now = new Date('2026-05-10T12:00:00.000Z');

    test('a published form before opensAt is not yet open', () => {
        assert.strictEqual(
            computeAvailability({ status: 'published', opensAt: '2026-05-12T00:00:00.000Z', closesAt: null }, now),
            'not-yet-open',
        );
    });

    test('a published form after closesAt is closed', () => {
        assert.strictEqual(
            computeAvailability({ status: 'published', opensAt: '2026-05-01T00:00:00.000Z', closesAt: '2026-05-09T00:00:00.000Z' }, now),
            'deadline-passed',
        );
    });

    test('a published form inside the window is open', () => {
        assert.strictEqual(
            computeAvailability({ status: 'published', opensAt: '2026-05-01T00:00:00.000Z', closesAt: '2026-05-20T00:00:00.000Z' }, now),
            'open',
        );
    });

    test('draft and closed statuses always win', () => {
        assert.strictEqual(computeAvailability({ status: 'draft', opensAt: null, closesAt: null }, now), 'draft');
        assert.strictEqual(computeAvailability({ status: 'closed', opensAt: null, closesAt: null }, now), 'closed-status');
    });
});

describe('public submit route contract', () => {
    test('converts stored timestamps before computing availability', () => {
        assert.ok(submitRoute.includes('toDateOrNull(fd.opensAt)'), 'opensAt uses the timestamp-safe conversion');
        assert.ok(submitRoute.includes('toDateOrNull(fd.closesAt)'), 'closesAt uses the timestamp-safe conversion');
        assert.ok(!submitRoute.includes('new Date(fd.opensAt'), 'raw Timestamp is never passed to Date');
    });

    test('signed-in duplicate submissions are atomic with the counter', () => {
        assert.ok(submitRoute.includes('batch.create(submissionRef, submission)'), 'create() makes duplicates fail atomically');
        assert.ok(submitRoute.includes('ALREADY_SUBMITTED'), 'duplicate answer is explicit');
    });
});
