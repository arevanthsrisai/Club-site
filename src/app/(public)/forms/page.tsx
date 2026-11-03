"use client";

/**
 * Public forms listing — published forms only (rules block everything else).
 * New URL under the existing (public) route group; the navbar links here as "Forms".
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { subscribeToPublicForms } from "@/services/forms";
import { computeAvailability, AVAILABILITY_MESSAGE, FORM_LIMITS } from "@/lib/forms";
import type { Form } from "@/types/forms";
import PageHeader from "@/components/ui/PageHeader";
import { ClipboardList, CalendarClock, Users, ChevronRight, Loader2, FileQuestion, WifiOff } from "lucide-react";

export default function FormsPage() {
    const [forms, setForms] = useState<Form[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        const unsub = subscribeToPublicForms(
            data => { setForms(data); setLoading(false); },
            () => { setLoading(false); setError(true); }
        );
        return () => unsub();
    }, []);

    return (
        <div className="min-h-screen px-4 pb-16 sm:px-6 lg:px-8">
            <PageHeader
                title="Forms"
                subtitle="Sign-ups, surveys and registrations currently open."
            />

            {loading ? (
                <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
                    <Loader2 size={32} className="animate-spin text-blue-500" aria-hidden="true" />
                    <p className="text-sm">Loading forms…</p>
                </div>
            ) : error ? (
                <div className="py-16 text-center text-gray-400">
                    <WifiOff size={40} className="mx-auto mb-4 text-gray-500" aria-hidden="true" />
                    <p className="text-sm">Could not load right now — check your connection and refresh.</p>
                </div>
            ) : forms.length === 0 ? (
                <div className="py-16 text-center text-gray-400">
                    <FileQuestion size={40} className="mx-auto mb-4 text-gray-500" aria-hidden="true" />
                    <p className="text-sm">No forms are open right now. Check back soon.</p>
                </div>
            ) : (
                <ul className="flex flex-col gap-4" aria-label="Open forms">
                    {forms.map(form => {
                        const availability = computeAvailability(form);
                        const open = availability === "open";
                        return (
                            <li key={form.id}>
                                <Link
                                    href={`/forms/${form.id}`}
                                    className="group block rounded-2xl border border-white/10 bg-black/30 p-5 sm:p-6 transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
                                            <ClipboardList size={20} className="text-blue-400" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h2 className="text-lg font-bold text-white">{form.title}</h2>
                                                <span
                                                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                                        open ? "bg-green-500/15 text-green-400 border border-green-500/25" : "bg-amber-500/15 text-amber-400 border border-amber-500/25"
                                                    }`}
                                                >
                                                    <CalendarClock size={12} aria-hidden="true" />
                                                    {open ? "Open now" : AVAILABILITY_MESSAGE[availability]}
                                                </span>
                                            </div>
                                            {form.description && (
                                                <p className="mt-1 text-sm text-gray-400 line-clamp-2">{form.description}</p>
                                            )}
                                        </div>
                                        <ChevronRight size={20} className="mt-1 shrink-0 text-gray-500 group-hover:text-white transition-colors" aria-hidden="true" />
                                    </div>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
