// Registrations close at the start of the event day (i.e. after 11:59 PM the day before).
// eventDateStr is the free-text date from the event form, e.g. "August 27, 2026".
export function isRegistrationWindowOpen(eventDateStr: string): boolean {
    if (!eventDateStr) return false;
    return new Date() < new Date(eventDateStr);
}

/**
 * Event dates are stored as human-readable strings ("December 5, 2026") because
 * they are rendered directly on cards, and the backend contract keeps them that
 * way. These helpers convert between that format and native <input type=date>
 * / <input type=time> values so forms use real date pickers without changing
 * what is persisted. All parsing is local-time, timezone-explicit — no UTC
 * shifting, since the club's events are local.
 */

/** Stored display date -> "yyyy-mm-dd" for a date input; null when unparseable. */
export function storedDateToInput(stored: string): string | null {
    if (!stored?.trim()) return null;
    const d = new Date(stored.trim());
    if (isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/** Date input value -> stored display format ("March 5, 2025"). */
export function inputDateToStored(input: string): string | null {
    if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
    const [y, m, d] = input.split("-").map(Number);
    // Constructed from local parts, so displayed and stored dates never shift.
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** "10:00 AM - 1:00 PM" -> { start: "10:00", end: "13:00" } for time inputs; nulls when absent/unparseable. */
export function storedTimeToInput(stored: string): { start: string | null; end: string | null } {
    const out = { start: null as string | null, end: null as string | null };
    if (!stored?.trim()) return out;
    const tokens = stored.match(/\d{1,2}(?::\d{2})?\s*(?:AM|PM)?/gi) || [];
    const toClock = (t: string): string | null => {
        const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
        if (!m) return null;
        let h = Number(m[1]);
        const min = m[2] ?? "00";
        const ap = m[3]?.toUpperCase();
        if (ap === "PM" && h < 12) h += 12;
        if (ap === "AM" && h === 12) h = 0;
        if (h > 23) return null;
        return `${String(h).padStart(2, "0")}:${min}`;
    };
    if (tokens[0]) out.start = toClock(tokens[0]);
    if (tokens.length > 1) out.end = toClock(tokens[tokens.length - 1]);
    return out;
}

/** Time input values -> stored display format ("10:00 AM - 1:00 PM"); null-only when everything is empty. */
export function inputTimeToStored(start: string | null, end: string | null): string {
    const fmt = (v: string): string => {
        const [h0, m] = v.split(":");
        const h = Number(h0);
        const ap = h < 12 ? "AM" : "PM";
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${m} ${ap}`;
    };
    if (start && end) return `${fmt(start)} - ${fmt(end)}`;
    if (start) return `${fmt(start)}`;
    if (end) return `${fmt(end)}`;
    return "";
}
