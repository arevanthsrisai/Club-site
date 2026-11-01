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
//     exCoreBatch: number        // academic-year START; 2027 = the 2027–2028 batch
//     roleHistory: [{ year: number; role: string }]  // academic years & roles held
//     displayOrder: number       // persisted order within the batch, lowest first
//     linkedUserId?: string | null  // admins/{uid} account that may self-edit
//   }
//
// The Ex-Core batch (the year they stepped down) is independent of the
// role-history years (the years they held individual roles). A member who was
// CTO in 2026–27 and President in 2027–28 has both role entries and one batch.

export type ExCoreMemberType = "core" | "activator";

export interface ExCoreRoleEntry {
    year: number; // academic-year start, e.g. 2026 = 2026–2027
    role: string; // club_roles id or free text for standalone profiles
}

export interface ExCoreMember {
    id: string;
    name: string;
    photoURL?: string | null;
    bio?: string;
    socials?: { linkedin?: string; github?: string; instagram?: string };
    memberType: ExCoreMemberType;
    exCoreBatch: number;
    roleHistory: ExCoreRoleEntry[];
    displayOrder: number;
    linkedUserId?: string | null;
    movedAt?: unknown;
    /** Firestore service may stamp extra fields; they pass through unread. */
    [key: string]: unknown;
}

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** Reliable numeric batch/year: round-trips strings, invalid values fall back. */
export function normalizeYear(input: unknown): number | null {
    const n = Number(input);
    if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) return null;
    return n;
}

/** "2027" → "2027–2028 Batch" heading label. */
export function batchLabel(batchYear: number | string | unknown): string {
    const y = normalizeYear(batchYear);
    if (y === null) return "Other";
    return `${y}–${(y % 100) + 1 < 10 ? "0" : ""}${(y % 100) + 1} Batch`;
}

/** "2026" → "2026–2027" label for role-history entries. */
export function academicYearLabel(year: number | string | unknown): string {
    const y = normalizeYear(year);
    if (y === null) return "—";
    return `${y}–${(y % 100) + 1 < 10 ? "0" : ""}${(y % 100) + 1}`;
}

export interface BatchGroup {
    year: number;
    label: string;
    core: ExCoreMember[]; // ordered
    activators: ExCoreMember[]; // ordered
}

/**
 * Groups members into batches sorted NEWEST first; inside a batch, custom
 * displayOrder wins (never alphabetical) and activates ties fall back to the
 * insertion order. Persists across devices because displayOrder lives in the
 * database.
 */
export function groupByBatchDesc(members: ExCoreMember[]): BatchGroup[] {
    const byYear = new Map<number, ExCoreMember[]>();
    for (const m of members) {
        const y = normalizeYear(m.exCoreBatch);
        // Malformed batches sink to the bottom of the newest-first list.
        const year = y === null ? MIN_YEAR - 1 : y;
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year)!.push(m);
    }
    const insertedAt = new Map(members.map((m, i) => [m.id, i]));
    const groups: BatchGroup[] = [...byYear.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([year, list]) => ({
            year,
            label: batchLabel(year),
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
 * Merged custom order across BOTH member types of a batch (used by the
 * move-up/move-down controls so core and activators share one sequence).
 */
export function mergedBatchOrder(group: BatchGroup): ExCoreMember[] {
    return [...group.core, ...group.activators].sort(
        (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
    );
}

/**
 * Normalizes a role-history payload into safe, deduped entries:
 * strips invalid years/roles, drops exact duplicates (same year AND role),
 * and sorts newest year first for display. Returns null when there are no
 * valid entries (also used to detect "no history provided").
 */
export function sanitizeRoleHistory(
    input: unknown,
): ExCoreRoleEntry[] | null {
    if (!Array.isArray(input)) return null;
    const seen = new Set<string>();
    const out: ExCoreRoleEntry[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== "object") continue;
        const year = normalizeYear((raw as { year?: unknown }).year);
        const role = typeof (raw as { role?: unknown }).role === "string"
            ? (raw as { role: string }).role.trim()
            : "";
        if (year === null || !role || role.length > 100) continue;
        const key = `${year}|${role.toLowerCase()}`;
        if (seen.has(key)) continue; // duplicate year+role protection
        seen.add(key);
        out.push({ year, role });
    }
    if (out.length === 0) return null;
    return out.sort((a, b) => b.year - a.year || a.role.localeCompare(b.role));
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
    return Object.keys(body).some(
        k => ["exCoreBatch", "memberType", "roleHistory", "displayOrder", "linkedUserId", "movedAt"].includes(k),
    );
}
