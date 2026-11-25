"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ExCoreRoleEntry, normalizeRoleEntry, sanitizeRoleHistory } from "@/lib/excore";

/**
 * Editor for Ex-Core role-history entries (tenure rows). Shared by the CTO's
 * Ex-Core manager and the member's own Ex-Core settings page so both write
 * exactly the same shape and validation to the server.
 *
 * Years are academic-year START years; `end` is exclusive, so 2026 → 2028
 * covers the 2026–27 and 2027–28 tenures.
 */

export interface RoleHistoryRow {
    start: string;
    end: string;
    role: string;
}

/** A fresh two-year tenure row starting this calendar year. */
export function defaultRoleHistoryRow(): RoleHistoryRow {
    const y = String(new Date().getFullYear());
    return { start: y, end: String(Number(y) + 1), role: "" };
}

/** Normalized domain entries → editable rows. */
export function roleHistoryToRows(
    history: ExCoreRoleEntry[] | { year?: unknown; startYear?: unknown; endYear?: unknown; role?: unknown }[] | null | undefined,
): RoleHistoryRow[] {
    return (history ?? [])
        .map(e => normalizeRoleEntry(e))
        .filter((e): e is ExCoreRoleEntry => e !== null)
        .map(e => ({ start: String(e.startYear), end: String(e.endYear), role: e.role }));
}

/** Editable rows → sanitized server payload (null when nothing valid remains). */
export function rowsToRoleHistory(rows: RoleHistoryRow[]): ExCoreRoleEntry[] | null {
    return sanitizeRoleHistory(rows.map(r => ({ startYear: r.start, endYear: r.end, role: r.role })));
}

interface RoleHistoryEditorProps {
    rows: RoleHistoryRow[];
    onChange: (rows: RoleHistoryRow[]) => void;
    roleOptions: string[];
    /** Required editors explain that at least one row is needed. */
    required?: boolean;
    title?: string;
}

export default function RoleHistoryEditor({
    rows,
    onChange,
    roleOptions,
    required = false,
    title = "Role history",
}: RoleHistoryEditorProps) {
    const listId = useId();

    return (
        <div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    {title} {required ? "" : "(optional)"}
                </span>
                <button
                    type="button"
                    onClick={() => onChange([...rows, defaultRoleHistoryRow()])}
                    className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                >
                    <Plus size={12} /> Add tenure
                </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
                Start and end are academic-year starts: 2026 → 2028 means the two-year 2026–27 and 2027–28 tenure. The member is displayed in both of those years.
            </p>
            <div className="mt-2 space-y-2">
                {rows.length === 0 && (
                    <p className="text-xs text-gray-500 italic py-1">No tenure added yet.</p>
                )}
                {rows.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                        <input
                            type="number"
                            min={2000}
                            max={2100}
                            value={row.start}
                            onChange={e => onChange(rows.map((r, j) => j === i ? { ...r, start: e.target.value } : r))}
                            placeholder="Start"
                            className="w-24 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            aria-label={`Tenure start year ${i + 1}`}
                        />
                        <input
                            type="number"
                            min={2000}
                            max={2100}
                            value={row.end}
                            onChange={e => onChange(rows.map((r, j) => j === i ? { ...r, end: e.target.value } : r))}
                            placeholder="End"
                            className="w-24 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            aria-label={`Tenure end year ${i + 1}`}
                        />
                        <input
                            type="text"
                            list={listId}
                            value={row.role}
                            onChange={e => onChange(rows.map((r, j) => j === i ? { ...r, role: e.target.value } : r))}
                            placeholder="Role held (e.g. CTO)"
                            className="flex-1 min-w-[160px] bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            aria-label={`Role held ${i + 1}`}
                        />
                        <button
                            type="button"
                            onClick={() => onChange(rows.filter((_, j) => j !== i))}
                            className="text-gray-500 hover:text-red-400 p-2"
                            aria-label={`Remove tenure entry ${i + 1}`}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>
            <datalist id={listId}>
                {roleOptions.map(r => <option key={r} value={r} />)}
            </datalist>
        </div>
    );
}
