// Unit tests for the admin dashboard's pure derivation logic
// (src/lib/dashboardInsights.ts). The dashboard is a thin render layer over
// these functions, so covering them here covers the dashboard's math.
import { test } from 'node:test';
import assert from 'node:assert';
import {
    summarizeEvents,
    upcomingEvents,
    attentionItems,
} from '../src/lib/dashboardInsights.ts';

const event = (over = {}) => ({
    id: 'e1',
    title: 'Test Event',
    date: 'August 27, 2026',
    status: 'upcoming',
    registrationStatus: 'upcoming',
    isFeedbackOpen: false,
    attendanceStatus: 'upcoming',
    ...over,
});

test('summarizeEvents counts lifecycle and open states', () => {
    const events = [
        event({ id: 'a' }),
        event({ id: 'b', status: 'ongoing', registrationStatus: 'open' }),
        event({ id: 'c', status: 'past', registrationStatus: 'closed' }),
        event({ id: 'd', status: 'past', registrationStatus: 'closed', isFeedbackOpen: true, attendanceStatus: 'active' }),
    ];
    const s = summarizeEvents(events);
    assert.strictEqual(s.total, 4);
    assert.strictEqual(s.upcoming, 1);
    assert.strictEqual(s.ongoing, 1);
    assert.strictEqual(s.past, 2);
    assert.strictEqual(s.registrationOpen, 1);
    assert.strictEqual(s.attendanceActive, 1);
    assert.strictEqual(s.feedbackOpen, 1);
});

test('summarizeEvents handles an empty list', () => {
    assert.deepStrictEqual(summarizeEvents([]), {
        total: 0, upcoming: 0, ongoing: 0, past: 0,
        registrationOpen: 0, attendanceActive: 0, feedbackOpen: 0,
    });
});

test('upcomingEvents sorts soonest-first and skips past/unparseable dates', () => {
    const now = new Date(2026, 6, 15); // July 15, 2026
    const events = [
        event({ id: 'far', date: 'December 5, 2026' }),
        event({ id: 'soon', date: 'August 1, 2026' }),
        event({ id: 'past', date: 'July 1, 2026' }),
        event({ id: 'today', date: 'July 15, 2026' }),
        event({ id: 'bad', date: 'sometime maybe' }),
    ];
    const out = upcomingEvents(events, now, 3);
    assert.deepStrictEqual(out.map((e) => e.id), ['today', 'soon', 'far']);
});

test('upcomingEvents is empty when everything is in the past', () => {
    const now = new Date(2027, 0, 1);
    assert.deepStrictEqual(upcomingEvents([event()], now), []);
});

test('attentionItems flags live attendance, open feedback and approvals', () => {
    const events = [
        event({ id: 'live', attendanceStatus: 'active' }),
        event({ id: 'feedback', isFeedbackOpen: true }),
        event({ id: 'quiet' }),
    ];
    const items = attentionItems(events, [
        { uid: 'u1', email: 'new.admin@av.students.amrita.edu' },
    ]);
    assert.strictEqual(items.length, 3);
    assert.deepStrictEqual(
        items.map((i) => i.kind).sort(),
        ['approval', 'attendance', 'feedback']
    );
    assert.ok(items.every((i) => i.href.startsWith('/admin/')), 'every item resolves to an admin page');
});

test('attentionItems is empty for a quiet dashboard', () => {
    assert.deepStrictEqual(attentionItems([event()], []), []);
});
