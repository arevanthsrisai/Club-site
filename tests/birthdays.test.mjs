// Unit tests for the pure DOB helpers (src/lib/birthdays.ts) — strict parsing,
// UTC-safe display formatting and leap-day-safe birthday matching.
import test from 'node:test';
import assert from 'node:assert';
import {
    parseDateString,
    formatDisplayDate,
    isBirthdayToday,
    isBirthdayOnParts,
    calendarPartsInTimeZone,
} from '../src/lib/birthdays.ts';

test('parseDateString accepts strict YYYY-MM-DD and rejects the rest', () => {
    assert.deepEqual(parseDateString('2000-03-15'), { year: 2000, month: 3, day: 15 });
    assert.deepEqual(parseDateString('2000-02-29'), { year: 2000, month: 2, day: 29 }); // 2000 is a leap year
    assert.equal(parseDateString('2001-02-29'), null); // leap day in a common year
    assert.equal(parseDateString('2000-13-01'), null);
    assert.equal(parseDateString('2000-00-01'), null);
    assert.equal(parseDateString('2000-04-31'), null); // April has 30 days
    assert.equal(parseDateString('15/03/2000'), null);
    assert.equal(parseDateString('2000-3-15'), null); // must be zero-padded
    assert.equal(parseDateString('2000-03-15T00:00:00Z'), null);
    assert.equal(parseDateString(''), null);
    assert.equal(parseDateString(null), null);
    assert.equal(parseDateString(20000315), null);
});

test('formatDisplayDate renders the stored day, never a UTC-shifted one', () => {
    // March 15 must render with day 15 — parsing "YYYY-MM-DD" as a UTC Date
    // would shift the day in negative-offset time zones; this guarantees not.
    const text = formatDisplayDate('2000-03-15');
    assert.match(text, /15/);
    assert.match(text, /mar/i);
    assert.match(text, /2000/);

    // Feb 29 must stay Feb 29 — no collapse into Feb 28 / Mar 1.
    const leapText = formatDisplayDate('2004-02-29');
    assert.match(leapText, /29/);

    assert.equal(formatDisplayDate('not-a-date'), '');
    assert.equal(formatDisplayDate(undefined), '');
});

test('isBirthdayToday matches the local calendar month + day, ignoring the year', () => {
    const march15 = new Date(2026, 2, 15); // Mar 15, local calendar

    assert.equal(isBirthdayToday('1998-03-15', march15), true);
    assert.equal(isBirthdayToday('1998-03-15', new Date(2026, 2, 16)), false);
    assert.equal(isBirthdayToday('1998-03-15', new Date(2026, 2, 14)), false);
    // The birth year itself never matters — that is the no-year-leak guarantee.
    assert.equal(isBirthdayToday('1960-03-15', march15), true);
    assert.equal(isBirthdayToday('not-a-dob', march15), false);
    assert.equal(isBirthdayToday(undefined, march15), false);
});

test('calendarPartsInTimeZone resolves the club date, not the server date', () => {
    // 2026-03-15T20:00Z is already Mar 16 in IST (+05:30). The scheduler must
    // mail on the club's date even when the process clock is UTC.
    const lateUtc = new Date('2026-03-15T20:00:00Z');
    assert.deepEqual(calendarPartsInTimeZone('Asia/Kolkata', lateUtc), { year: 2026, month: 3, day: 16 });
    assert.deepEqual(calendarPartsInTimeZone('UTC', lateUtc), { year: 2026, month: 3, day: 15 });

    // Just before midnight IST is still the previous day in UTC.
    const earlyIst = new Date('2026-03-15T18:20:00Z');
    assert.deepEqual(calendarPartsInTimeZone('Asia/Kolkata', earlyIst), { year: 2026, month: 3, day: 15 });
});

test('isBirthdayOnParts matches a resolved calendar day', () => {
    assert.equal(isBirthdayOnParts('1998-03-16', { year: 2026, month: 3, day: 16 }), true);
    assert.equal(isBirthdayOnParts('1998-03-15', { year: 2026, month: 3, day: 16 }), false);
    // Feb 29 celebrates on Feb 28 in a common year, and only then.
    assert.equal(isBirthdayOnParts('2000-02-29', { year: 2026, month: 2, day: 28 }), true);
    assert.equal(isBirthdayOnParts('2000-02-29', { year: 2024, month: 2, day: 28 }), false);
    assert.equal(isBirthdayOnParts(undefined, { year: 2026, month: 3, day: 16 }), false);
});

test('isBirthdayToday handles leap-day DOBs consistently', () => {
    const feb28Common = new Date(2026, 1, 28); // 2026 is a common year
    const feb28Leap = new Date(2024, 1, 28);   // 2024 is a leap year
    const feb29Leap = new Date(2024, 1, 29);
    const mar1Common = new Date(2026, 2, 1);

    assert.equal(isBirthdayToday('2000-02-29', feb28Common), true); // fallback: Feb 28 in common years
    // Feb 29 does not exist in a common year; Date(2026,1,29) rolls over to
    // Mar 1. Under the Feb-28 fallback the birthday is NOT celebrated on Mar 1.
    assert.equal(isBirthdayToday('2000-02-29', mar1Common), false);
    assert.equal(isBirthdayToday('2000-02-29', feb28Leap), false);  // Feb 28 in a leap year is not the birthday
    assert.equal(isBirthdayToday('2000-02-29', feb29Leap), true);
});
