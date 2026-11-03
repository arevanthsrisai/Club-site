// Ex-Core domain logic — shared by the public page, the admin manager and the
// server API routes. Pure functions only: no Firestore, no React.
//
// Data model (Firestore collection: ex_core_members):
//   {
//     name: string
//     photoURL?: string | null
//     bio?: string
//     socials?: { linkedin?; github?; instagram? }
//     memberType: "core" | "activator"
//     roleHistory: [
//       { startYear: number; endYear: number; role: string }
//     ]
//     displayOrder: number       // persisted global order, lowest first
//     linkedUserId?: string | null  // admins/{uid} account that may self-edit
//   }
//
// TENURE: every role-history entry carries the academic-YEAR START of the
// FIRST and LAST year of the tenure it records (both inclusive). A standard
// two-year core tenure starting in 2026 is { startYear: 2026, endYear: 2027 } —
// it covers 2026–2027 AND 2027–2028, so the person is displayed in both year
// sections from ONE profile record (never a duplicate profile per year).
// A single-year entry has endYear === startYear.
//
// LEGACY compatibility: older documents stored a single `exCoreBatch` per
// member and role-history entries shaped { year } (one academic year each).
// Those fields are still READ so existing records keep displaying correctly,
// but nothing writes them anymore — legacy rows normalize to one-year tenures,
// and a member without role history falls back to its legacy exCoreBatch year.

export type ExCoreMemberType = "core" | "activator";

export interface ExCoreRoleEntry {
    startYear: number; // academic-year start of the FIRST year of the tenure
    endYear: number;   // academic-year start of the LAST year of the tenure (>= startYear)
    role: string;      // club_roles id or free text for standalone profiles
}

/** Legacy one-year role entry still read from existing documents. */
export interface LegacyRoleEntry {
    year: number; // academic-year start, e.g. 2026 = 2026–2027
    role: string;
}

export type ExCoreRoleHistoryInput = (ExCoreRoleEntry | LegacyRoleEntry)[];

export interface ExCoreMember {
    id: string;
    name: string;
    photoURL?: string | null;
    bio?: string;
    socials?: { linkedin?: string; github?: string; instagram?: string };
    memberType: ExCoreMemberType;
    roleHistory: ExCoreRoleHistoryInput;
    displayOrder: number;
    linkedUserId?: string | null;
    movedAt?: unknown;
    /** Legacy single-year batch (the year they stepped down). Inert: read only. */
    exCoreBatch?: unknown;
    /** Firestore service may stamp extra fields; they pass through unread. */
    [key: string]: unknown;
}

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** Reliable numeric year: round-trips strings, invalid values fall back. */
export function normalizeYear(input: unknown): number | null {
    const n = Number(input);
    if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) return null;
    return n;
}

/** "2026" → "2026–27" label for a single academic year. */
export function academicYearLabel(year: number | string | unknown): string {
    const y = normalizeYear(year);
    if (y === null) return "—";
    const hi = (y % 100) + 1;
    return `${y}–${hi < 10 ? "0" : ""}${hi}`;
}

/** "2026", "2028" → "2026–28" label for a multi-year tenure. */
export function tenureLabel(
    startYear: number | string | unknown,
    endYear: number | string | unknown,
): string {
    const s = normalizeYear(startYear);
    let e = normalizeYear(endYear);
    if (s === null) return "—";
    if (e === null || e < s) return "—";
    if (e === s) return academicYearLabel(s);
    // Use endYear directly so 2025 → 2026 yields "2025–26" batch label.
    const hi = e % 100;
    return `${s}–${hi < 10 ? "0" : ""}${hi}`;
}

/**
 * Normalizes ONE role-history entry (new { startYear, endYear, role } shape or
 * legacy { year, role } shape) into the current representation. Returns null
 * when the entry cannot be salvaged. endYear < startYear is clamped to a
 * one-year tenure so a bad payload can never create an inverted range.
 */
export function normalizeRoleEntry(raw: unknown): ExCoreRoleEntry | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const role = typeof r.role === "string" ? r.role.trim() : "";
    if (!role || role.length > 100) return null;
    let start = normalizeYear(r.startYear);
    let end = normalizeYear(r.endYear);
    // Legacy entries carry a single `year` instead; that covers one batch
    // so endYear is startYear + 1 (exclusive end).
    if (start === null) start = normalizeYear(r.year);
    if (start === null) return null;
    // endYear is EXCLUSIVE: 2024→2025 covers the 2024-25 batch only;
    // 2024→2026 covers the 2024-25 and 2025-26 batches (two batches from one entry).
    if (end === null) end = start + 1; // legacy single-year entry
    if (end < start) [start, end] = [end, start]; // typed years backwards — keep both, nothing deleted
    if (end === start) end = start + 1; // same start/end year → one-year tenure, don't delete
    return { startYear: start, endYear: end, role };
}

/**
 * Normalizes a role-history payload into safe, normalized, deduped entries:
 * accepts both the current { startYear, endYear, role } shape and the legacy
 * { year, role } shape, strips invalid entries, drops exact duplicates
 * (same range AND role), and sorts newest tenure first for display. Returns
 * null when there are no valid entries (also used to detect "no history").
 */
export function sanitizeRoleHistory(
    input: unknown,
): ExCoreRoleEntry[] | null {
    if (!Array.isArray(input)) return null;
    const seen = new Set<string>();
    const out: ExCoreRoleEntry[] = [];
    for (const raw of input) {
        const entry = normalizeRoleEntry(raw);
        if (!entry) continue;
        const key = `${entry.startYear}|${entry.endYear}|${entry.role.toLowerCase()}`;
        if (seen.has(key)) continue; // duplicate range+role protection
        seen.add(key);
        out.push(entry);
    }
    if (out.length === 0) return null;
    return out.sort((a, b) =>
        b.startYear - a.startYear || b.endYear - a.endYear || a.role.localeCompare(b.role));
}

export const PRIVILEGED_MEMBER_FIELDS = ["exCoreBatch", "memberType", "roleHistory", "displayOrder", "linkedUserId", "movedAt"] as const;

/**
 * Every academic year a member covers, newest first — used for the public
 * year sections (a two-year tenure yields BOTH of its years). Members with
 * no valid role history fall back to their legacy exCoreBatch year so
 * pre-tenure records keep displaying; members with neither return [].
 */
export function memberTenureYears(m: ExCoreMember): number[] {
    const years = new Set<number>();
    for (const raw of m.roleHistory ?? []) {
        const entry = normalizeRoleEntry(raw);
        if (!entry) continue;
        // endYear is exclusive: 2024→2026 yields years 2024 and 2025.
        for (let y = entry.startYear; y < entry.endYear; y++) years.add(y);
    }
    if (years.size === 0) {
        const legacy = normalizeYear((m as { exCoreBatch?: unknown }).exCoreBatch);
        if (legacy !== null) years.add(legacy);
    }
    return [...years].sort((a, b) => b - a);
}

export interface TenureYearGroup {
    /** Academic-year start of the section; members with no tenure sink here as YEARLESS. */
    year: number;
    label: string;
    core: ExCoreMember[]; // ordered by persisted display order
    activators: ExCoreMember[]; // ordered by persisted display order
}

/** Sentinel year below every real academic year for members with no tenure. */
export const YEARLESS = MIN_YEAR - 1;

/**
 * Groups members into academic-YEAR sections sorted NEWEST first (based on
 * their role-history tenure; legacy exCoreBatch acts as fallback). Inside a
 * section, custom displayOrder wins (never alphabetical) and ties fall back
 * to the insertion order. A two-year member appears in BOTH of their year
 * sections from the same profile — displayOnly duplication, never a second
 * profile record.
 */
export function groupByTenureYearDesc(members: ExCoreMember[]): TenureYearGroup[] {
    const byYear = new Map<number, ExCoreMember[]>();
    for (const m of members) {
        const years = memberTenureYears(m);
        // Members with no tenure at all sink to the bottom "Other" section.
        const ys = years.length ? years : [YEARLESS];
        for (const y of ys) {
            if (!byYear.has(y)) byYear.set(y, []);
            byYear.get(y)!.push(m);
        }
    }
    const insertedAt = new Map(members.map((m, i) => [m.id, i] as const));
    const groups: TenureYearGroup[] = [...byYear.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([year, list]) => ({
            year,
            label: year === YEARLESS ? "Other" : academicYearLabel(year),
            // Custom order first; ties → first-seen order for stability.
            core: list
                .filter(m => m.memberType !== "activator")
                .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || (insertedAt.get(a.id)! - insertedAt.get(b.id)!)),
            activators: list
                .filter(m => m.memberType === "activator")
                .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || (insertedAt.get(a.id)! - insertedAt.get(b.id)!)),
        }));
    return groups;
}

/**
 * Global display order of ALL Ex-Core members (one cross-year sequence).
 * displayOrder is no longer batch-scoped: the persisted custom order wins
 * across the whole page, and each year section derives its running order by
 * filtering this sequence.
 */
export function globalDisplayOrder(members: ExCoreMember[]): string[] {
    const insertedAt = new Map(members.map((m, i) => [m.id, i] as const));
    return [...members]
        .sort((a, b) =>
            (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
            insertedAt.get(a.id)! - insertedAt.get(b.id)!)
        .map(m => m.id);
}

/**
 * Newest-tenure-first role cap for profile cards/modal labels. Falls back to
 * the member type label when the record carries no usable role entries.
 */
export function latestRoleLabel(m: ExCoreMember, memberType: ExCoreMemberType): string {
    const normalized = (m.roleHistory ?? [])
        .map(normalizeRoleEntry)
        .filter((e): e is ExCoreRoleEntry => e !== null);
    if (normalized.length === 0) return memberType === "activator" ? "Activator" : "Ex-Core";
    return normalized[0].role;
}

/** The only fields an Ex-Core owner may change about their own profile. */
export const OWNER_EDITABLE_FIELDS = ["name", "photoURL", "bio", "socials"] as const;

/** True when body contains ONLY owner-editable keys (used by /self route). */
export function hasOnlyOwnerFields(body: Record<string, unknown>): boolean {
    const keys = Object.keys(body);
    return keys.length > 0 && keys.every(k => (OWNER_EDITABLE_FIELDS as readonly string[]).includes(k));
}

/** True when a privileged field is present (the /self route must reject it). */
export function containsPrivilegedField(body: Record<string, unknown>): boolean {
    return Object.keys(body).some(k => (PRIVILEGED_MEMBER_FIELDS as readonly string[]).includes(k));
}
