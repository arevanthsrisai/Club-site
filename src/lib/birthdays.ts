// Shared date-of-birth helpers.
//
// DOB is stored as a plain "YYYY-MM-DD" string (Firestore keeps strings and
// there is no UTC anchor to shift it). Display and birthday matching therefore
// never construct a Date from the raw string — `new Date("YYYY-MM-DD")` parses
// as UTC midnight, so in negative-UTC-offset time zones the local calendar date
// rendered from it lands one day before the stored one. Parsing the parts and
// building a local date keeps the displayed day identical everywhere.

export interface DateParts {
    year: number;
    month: number; // 1-12
    day: number;   // 1-31
}

/** Strict "YYYY-MM-DD" parser; returns null for every other shape. */
export function parseDateString(value: unknown): DateParts | null {
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Reject impossible calendar days before going on to date math.
    if (day > daysInMonth(year, month)) return null;
    return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Birthday check against the caller's local calendar (pass `new Date()`).
 * Feb 29 birthdays are celebrated on Feb 28 in non-leap years so the member
 * still gets their announcement every year. No birth year is used or returned.
 */
export function isBirthdayToday(dob: unknown, now: Date): boolean {
    const parts = parseDateString(dob);
    if (!parts) return false;
    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();
    // Feb 29 → Feb 28 fallback in non-leap years (checked first, so the same-
    // month comparison below never swallows the fallback).
    if (parts.month === 2 && parts.day === 29 && !isLeapYear(now.getFullYear())) {
        return todayMonth === 2 && todayDay === 28;
    }
    if (parts.month === todayMonth) return parts.day === todayDay;
    return false;
}

/** Human "15 Mar 2000" date built from local parts — UTC-safe by construction. */
export function formatDisplayDate(value: unknown): string {
    const parts = parseDateString(value);
    if (!parts) return "";
    const date = new Date(parts.year, parts.month - 1, parts.day);
    return date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}
