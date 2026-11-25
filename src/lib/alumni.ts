/**
 * Alumni batches.
 *
 * The joining year is the single source of truth. A batch is the four-year
 * programme that starts in that year: 2025 → "2025-2029". Admin forms ask for
 * the joining year and derive the batch; nothing asks for a batch label by
 * hand.
 *
 * Older records only carry a free-text `batchYear` ("2020-2024", "2021", …).
 * Those still display correctly: the first four-digit year is read as the
 * joining year. Everything is structural (no Firestore/React imports) so both
 * pages and the unit tests can share it.
 */

/** Length of an undergraduate programme, in years. */
export const ALUMNI_BATCH_LENGTH = 4;

/** Earliest joining year accepted by the admin form. */
export const ALUMNI_MIN_JOINING_YEAR = 2000;

/** Section label used when no joining year can be derived. */
export const UNKNOWN_BATCH_LABEL = "Batch not set";

export interface AlumniBatchFields {
    id?: string;
    name?: string;
    /** Preferred field for records created after batches became derived. */
    joiningYear?: number | string | null;
    /** Legacy free-text label, still read for records written before that. */
    batchYear?: string | null;
}

/** Reliable joining year: accepts "2025" or 2025, rejects empty/future values. */
export function normalizeJoiningYear(input: unknown): number | null {
    if (input === null || input === undefined) return null;
    if (typeof input === "string" && input.trim() === "") return null;
    const year = Number(input);
    if (!Number.isInteger(year)) return null;
    if (year < ALUMNI_MIN_JOINING_YEAR) return null;
    // A person cannot join in the future; this also catches typos like 2205.
    if (year > new Date().getFullYear()) return null;
    return year;
}

/** 2025 → "2025-2029". */
export function batchLabelFromJoiningYear(year: number): string {
    return `${year}-${year + ALUMNI_BATCH_LENGTH}`;
}

/** Extracts the joining year from a legacy free-text batch label, if any. */
export function joiningYearFromLegacyBatch(batchYear: unknown): number | null {
    if (typeof batchYear !== "string") return null;
    const match = batchYear.match(/(19|20)\d{2}/);
    if (!match) return null;
    return normalizeJoiningYear(match[0]);
}

/** The record's joining year: the stored field first, then the legacy label. */
export function alumniJoiningYear(alumnus: AlumniBatchFields): number | null {
    return normalizeJoiningYear(alumnus.joiningYear)
        ?? joiningYearFromLegacyBatch(alumnus.batchYear);
}

/**
 * The batch label shown to people. New records derive it from the joining
 * year; legacy free text is preserved when no year can be read, and records
 * with neither land in the shared "Batch not set" section.
 */
export function alumniBatchLabel(alumnus: AlumniBatchFields): string {
    const year = alumniJoiningYear(alumnus);
    if (year !== null) return batchLabelFromJoiningYear(year);
    const legacy = typeof alumnus.batchYear === "string" ? alumnus.batchYear.trim() : "";
    return legacy || UNKNOWN_BATCH_LABEL;
}

export interface AlumniBatchGroup<T> {
    /** Derived label, e.g. "2025-2029" or "Batch not set". */
    batch: string;
    /** Null for the unassigned group. */
    joiningYear: number | null;
    title: string;
    members: T[];
}

/**
 * Groups alumni by batch, newest batch first, with the unassigned group last.
 * Members inside a batch are ordered by name so both pages agree.
 */
export function groupAlumniByBatch<T extends AlumniBatchFields>(alumni: T[]): AlumniBatchGroup<T>[] {
    const groups = new Map<string, { joiningYear: number | null; members: T[] }>();

    for (const alumnus of alumni) {
        const batch = alumniBatchLabel(alumnus);
        const existing = groups.get(batch);
        if (existing) {
            existing.members.push(alumnus);
        } else {
            groups.set(batch, { joiningYear: alumniJoiningYear(alumnus), members: [alumnus] });
        }
    }

    return [...groups.entries()]
        .map(([batch, group]) => ({
            batch,
            joiningYear: group.joiningYear,
            title: group.joiningYear === null ? UNKNOWN_BATCH_LABEL : `Batch ${batch}`,
            members: group.members,
        }))
        .sort((a, b) => {
            if (a.joiningYear === null && b.joiningYear === null) return a.batch.localeCompare(b.batch);
            if (a.joiningYear === null) return 1;
            if (b.joiningYear === null) return -1;
            return b.joiningYear - a.joiningYear;
        })
        .map(group => ({
            ...group,
            members: [...group.members].sort((a, b) =>
                (a.name ?? "").localeCompare(b.name ?? "") || (a.id ?? "").localeCompare(b.id ?? ""),
            ),
        }));
}
