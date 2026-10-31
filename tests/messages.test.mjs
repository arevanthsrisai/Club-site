// Unit tests for the contact-message workflow helpers.
// The inbox is a thin render layer over these pure helpers, so covering them
// here covers the solved/reminder math without needing Firestore.
import { test } from 'node:test';
import assert from 'node:assert';
import {
    summarizeMessages,
    unsolvedCount,
    dueReminders,
    recentUnsolved,
} from '../src/lib/messageWorkflow.ts';

const msg = (over = {}) => ({
    id: 'm1',
    name: 'Tester',
    email: 't@x.com',
    subject: 'Hi',
    message: 'body',
    timestamp: { seconds: 1000 },
    ...over,
});

const ts = (seconds) => ({ seconds });

test('summarizeMessages counts solved and reminder states', () => {
    const now = Date.now();
    const messages = [
        msg({ id: 'a', solved: false }),
        msg({ id: 'b', solved: true, solvedAt: ts(2000) }),
        msg({ id: 'c', solved: false, reminderAt: ts(Math.floor((now - 3600000) / 1000)) }), // overdue
        msg({ id: 'd', solved: false, reminderAt: ts(Math.floor((now + 3600000) / 1000)) }), // upcoming
    ];
    const s = summarizeMessages(messages, now);
    assert.strictEqual(s.total, 4);
    assert.strictEqual(s.solved, 1);
    assert.strictEqual(s.unsolved, 3);
    assert.strictEqual(s.remindersDue, 1);
    assert.strictEqual(s.remindersUpcoming, 1);
});

test('unsolvedCount ignores solved messages', () => {
    assert.strictEqual(unsolvedCount([msg({ solved: false }), msg({ solved: true })]), 1);
    assert.strictEqual(unsolvedCount([msg({ solved: true }), msg({ solved: true })]), 0);
});

test('dueReminders flags lapsed reminders only', () => {
    const now = Date.now();
    const past = ts(Math.floor((now - 60000) / 1000));
    const future = ts(Math.floor((now + 60000) / 1000));
    const due = dueReminders([msg({ reminderAt: past }), msg({ reminderAt: future })], now);
    assert.strictEqual(due.length, 1);
    assert.strictEqual(due[0].id, 'm1');
});

test('recentUnsolved returns newest-first, capped', () => {
    const messages = [
        msg({ id: 'old', timestamp: ts(100) }),
        msg({ id: 'new', timestamp: ts(300) }),
        msg({ id: 'solved', timestamp: ts(200), solved: true }),
    ];
    const out = recentUnsolved(messages, 5);
    assert.deepStrictEqual(out.map((m) => m.id), ['new', 'old']);
    const capped = recentUnsolved(messages, 1);
    assert.strictEqual(capped.length, 1);
    assert.strictEqual(capped[0].id, 'new');
});

test('summarizeMessages handles empty list', () => {
    assert.deepStrictEqual(summarizeMessages([]), {
        total: 0, solved: 0, unsolved: 0, remindersDue: 0, remindersUpcoming: 0,
    });
});