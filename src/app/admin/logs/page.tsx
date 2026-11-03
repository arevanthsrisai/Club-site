"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDocs, collection, query, orderBy, startAfter, limit as fsLimit, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { AuditLog } from "@/lib/api";
import { Activity, Search, RefreshCw, ChevronRight, Loader2, AlertCircle, Download, CalendarDays } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { convertToCSV } from "@/lib/csvUtils";

/**
 * Extended activity log: real audit_logs records only — no fabricated
 * activity. Firestore rules allow admins to read audit_logs; sensitive
 * material is never rendered (see redaction below), and every read stays
 * browser-side against data the caller may already read by rules.
 *
 * Features: free-text search, action prefix filter, date range, actor filter,
 * paging (Firestore cursors), per-record detail expansion, and CSV export of
 * the loaded window.
 */

const PAGE_SIZE = 50;
// Never render these detail keys even if something ever landed there.
const REDACTED_KEY_RE = /token|password|secret|cookie|credential|pass\b/i;

interface DateRange { from: string; to: string; }

// Coarse action grouping so the filter dropdown stays useful as the log grows.
const ACTION_GROUPS: { label: string; match: RegExp }[] = [
    { label: "Admin management", match: /admin|role|approv|reject|nickname|doomsday|handover|transfer/i },
    { label: "Events", match: /event|attend|feedback|registration/i },
    { label: "Media & uploads", match: /upload|media|gallery|delet|b2|avatar|stored/i },
    { label: "Resources & settings", match: /resource|setting/i },
    { label: "System", match: /system|tenure|purge|error/i },
];

export default function LogsPage() {
    const { profile } = useAuth();
    const toast = useToast();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [cursor, setCursor] = useState<unknown>(null);
    const [hasMore, setHasMore] = useState(false);

    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [group, setGroup] = useState("all");
    const [range, setRange] = useState<DateRange>({ from: "", to: "" });

    const [openId, setOpenId] = useState<string | null>(null);
    const cursorRef = useRef<unknown>(null);

    // Debounce the free-text search.
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 350);
        return () => clearTimeout(t);
    }, [searchInput]);

    const load = useCallback(async (opts?: { append?: boolean }) => {
        setLoading(true);
        setError(null);
        try {
            const constraints = [orderBy("timestamp", "desc"), fsLimit(PAGE_SIZE)];
            if (opts?.append && cursorRef.current) {
                constraints.push(startAfter(cursorRef.current) as never);
            }
            const snap = await getDocs(query(collection(db, "audit_logs"), ...constraints));
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog));
            // Date filtering is applied client-side: covering ranges needs a
            // composite index per range combination, and the log is bounded.
            cursorRef.current = snap.docs[snap.docs.length - 1] ?? null;
            setHasMore(snap.docs.length === PAGE_SIZE);
            setLogs(prev => (opts?.append ? [...prev, ...items] : items));
        } catch (e: any) {
            setError(e?.message || "Could not load the activity log.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); cursorRef.current = null; }, [load]);

    const filtered = useMemo(() => {
        const from = range.from ? new Date(range.from + "T00:00:00").getTime() : 0;
        const to = range.to ? new Date(range.to + "T23:59:59.999").getTime() : Infinity;
        const matcher = group === "all" ? null : ACTION_GROUPS.find(g => g.label === group)?.match;
        return logs.filter(l => {
            const ts = l.timestamp?.toDate ? l.timestamp.toDate().getTime() : 0;
            if (ts < from || ts > to) return false;
            if (matcher && !matcher.test(l.action || "")) return false;
            if (search) {
                const haystack = `${l.actorName || ""} ${l.action || ""} ${JSON.stringify(l.details ?? {})}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            return true;
        });
    }, [logs, search, group, range]);

    const exportCSV = () => {
        const rows = filtered.map(l => ({
            Timestamp: l.timestamp?.toDate?.().toLocaleString("en-GB") ?? "",
            Actor: l.actorName || "",
            ActorUid: l.actorUid || "",
            Action: l.action || "",
            Details: JSON.stringify(stripSensitive(l.details ?? {})),
        }));
        convertToCSV(rows, "relu_activity_log");
        toast.success(`Exported ${rows.length} records.`);
    };

    return (
        <div className="max-w-6xl mx-auto text-white">
            <PageHeader
                title="Activity Log"
                subtitle="Every recorded admin action — search, filter and inspect."
                icon={<Activity size={26} />}
                actions={
                    <div className="flex items-center gap-2">
                        <button onClick={exportCSV} disabled={filtered.length === 0}
                            className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-40"
                            title="Export the filtered view as CSV" aria-label="Export filtered log as CSV">
                            <Download size={16} />
                        </button>
                        <button onClick={() => { cursorRef.current = null; load(); }}
                            className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white transition-colors"
                            title="Refresh" aria-label="Refresh activity log">
                            <RefreshCw size={16} />
                        </button>
                    </div>
                }
            />
            {!profile && <GuardHint />}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="relative flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                    <input
                        type="search"
                        aria-label="Search activity log"
                        placeholder="Search actor, action or details…"
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm focus:border-blue-500 outline-none"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                    />
                </div>
                <select
                    aria-label="Filter by action category"
                    className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white text-sm sm:w-52"
                    value={group}
                    onChange={e => setGroup(e.target.value)}
                >
                    <option value="all">All categories</option>
                    {ACTION_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
                </select>
                <div className="flex gap-2">
                    <div className="relative cursor-pointer" onClick={e => {
                        e.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                    }}>
                        <input
                            type="date"
                            aria-label="From date"
                            className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white text-sm [color-scheme:dark] pl-8"
                            value={range.from}
                            onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
                        />
                        <button
                            type="button"
                            onClick={e => {                                e.stopPropagation();
                                e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                            }}
                            aria-label="Open date picker"
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white transition-colors"
                        >
                            <CalendarDays size={14} aria-hidden="true" />
                        </button>
                    </div>
                    <div className="relative cursor-pointer" onClick={e => {
                        e.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                    }}>
                        <input
                            type="date"
                            aria-label="To date"
                            className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white text-sm [color-scheme:dark] pl-8"
                            value={range.to}
                            onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
                        />
                        <button
                            type="button"
                            onClick={e => {
                                e.stopPropagation();
                                e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                            }}
                            aria-label="Open date picker"
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white transition-colors"
                        >
                            <CalendarDays size={14} aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </div>

            {loading && logs.length === 0 ? (
                <div className="space-y-2" role="status" aria-label="Loading activity log">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
                    ))}
                </div>
            ) : error ? (
                <div className="p-8 text-center bg-white/5 rounded-2xl border border-red-500/25" role="alert">
                    <AlertCircle className="mx-auto text-red-400 mb-3" size={28} />
                    <p className="text-red-300 font-semibold mb-1">Could not load the activity log</p>
                    <p className="text-gray-400 text-sm mb-4">{error}</p>
                    <button onClick={() => load()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold">Try again</button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="p-12 text-center bg-white/5 rounded-2xl border border-white/10">
                    <Activity size={40} className="mx-auto text-gray-600 mb-4" />
                    <p className="text-gray-300 font-medium">
                        {logs.length === 0 ? "No activity recorded yet." : "No records match the current filters."}
                    </p>
                    {(search || group !== "all" || range.from || range.to) && (
                        <button
                            onClick={() => { setSearchInput(""); setGroup("all"); setRange({ from: "", to: "" }); }}
                            className="mt-3 text-sm text-blue-400 hover:text-blue-300"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            ) : (
                <>
                    <p className="text-xs text-gray-500 mb-2" aria-live="polite">
                        Showing {filtered.length} of {logs.length} loaded records{filtered.length !== logs.length ? " (filtered)" : ""}.
                    </p>
                    <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/5">
                        {filtered.map(log => <LogRow key={log.id} log={log} open={openId === log.id} onToggle={() => setOpenId(openId === log.id ? null : log.id)} />)}
                    </ul>
                    {hasMore && (
                        <div className="text-center mt-4">
                            <button
                                onClick={() => load({ append: true })}
                                className="px-5 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-semibold hover:bg-white/10 inline-flex items-center gap-2"
                            >
                                Load 50 more <ChevronRight size={14} />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function GuardHint() {
    return (
        <p className="mb-6 text-xs text-yellow-400/90 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            Sign in as an approved admin to have read access recognized. Firestore rules only allow admins to read this collection.
        </p>
    );
}

function stripSensitive(details: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
        if (!k || REDACTED_KEY_RE.test(k)) continue;
        const s = typeof v === "string" ? v : JSON.stringify(v) ?? "";
        if (s === "{}" || s === "[]" || s.length === 0) continue;
        out[k] = v;
    }
    return out;
}

function LogRow({ log, open, onToggle }: { log: AuditLog; open: boolean; onToggle: () => void }) {
    const when = log.timestamp?.toDate ? log.timestamp.toDate() : null;
    const detailEntries = open ? Object.entries(stripSensitive((log.details ?? {}) as Record<string, unknown>)) : null;
    const groupLabel = ACTION_GROUPS.find(g => g.match.test(log.action || ""))?.label ?? "Other";

    return (
        <li>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            >
                <ChevronRight size={14} className={`text-gray-600 transition-transform shrink-0 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200 break-words">
                        <span className="font-semibold text-blue-300">{log.actorName || "An admin"}</span>{" "}
                        <span className="text-gray-300">{log.action}</span>
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                        <span className="px-1.5 rounded bg-white/10">{groupLabel}</span>
                        {when && <time>{when.toLocaleString("en-GB")}</time>}
                    </p>
                </div>
            </button>
            {open && (
                <div className="px-4 pb-4 pt-1 ml-[5px] border-l border-white/10">
                    {detailEntries && detailEntries.length > 0 ? (
                        <dl className="space-y-1.5 text-xs text-gray-300 max-w-full">
                            {detailEntries.map(([k, v]) => (
                                <div key={k} className="grid grid-cols-[auto_1fr] gap-2 max-sm:block">
                                    <dt className="text-gray-500 font-semibold break-words">{k}:</dt>
                                    <dd className="break-words whitespace-pre-wrap font-mono overflow-hidden">{typeof v === "string" ? v : JSON.stringify(v, null, 2)}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p className="text-gray-500 italic text-sm">No additional details were recorded for this action.</p>
                    )}
                    <p className="text-[11px] text-gray-600 mt-2 font-mono break-all">actor uid: {log.actorUid}</p>
                </div>
            )}
        </li>
    );
}
