"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createEvent, updateEvent, Event } from "@/lib/api";
import ImageUpload from "@/components/ui/ImageUpload";
import MarkdownEditor from "@/components/admin/MarkdownEditor";
import { Sparkles, Save, X, Calendar, Clock } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { storedDateToInput, inputDateToStored, storedTimeToInput, inputTimeToStored } from "@/lib/dateUtils";

interface EventFormProps {
    initialData?: Event;
    isEdit?: boolean;
}

export default function EventForm({ initialData, isEdit = false }: EventFormProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const toast = useToast();
    const [dateError, setDateError] = useState("");
    const [teamSizeError, setTeamSizeError] = useState("");
    // Native date/time pickers work in input-native formats; the stored fields
    // keep the site's existing display strings (see lib/dateUtils.ts).
    const [dateInput, setDateInput] = useState<string>(() => storedDateToInput(initialData?.date || "") ?? "");
    const [timeRange, setTimeRange] = useState<{ start: string | null; end: string | null }>(
        () => storedTimeToInput(initialData?.time || "")
    );
    const [timeError, setTimeError] = useState("");
    const [formData, setFormData] = useState<Omit<Event, "id"> | Event>(
        {
            title: initialData?.title || "",
            date: initialData?.date || "",
            time: initialData?.time || "",
            venue: initialData?.venue || "",
            description: initialData?.description || "",
            fullDescription: initialData?.fullDescription || "",
            details: initialData?.details || [],
            image: initialData?.image || "",
            status: initialData?.status || "upcoming",
            registrationStatus: initialData?.registrationStatus || "upcoming",
            isFeedbackOpen: initialData?.isFeedbackOpen || false,
            avgRating: initialData?.avgRating || 0,
            feedbackCount: initialData?.feedbackCount || 0,
            minTeamSize: initialData?.minTeamSize || 1,
            maxTeamSize: initialData?.maxTeamSize || 1,
            maxParticipants: initialData?.maxParticipants ?? undefined,
            enableWaitlist: initialData?.enableWaitlist ?? false
        }
    );

    // Validate the whole form and surface at most the first problem inline.
    const validate = (): string => {
        if (!formData.title.trim()) return "Give the event a title.";
        if (!dateInput) return "Pick the event date.";
        if ((formData.minTeamSize ?? 1) < 1) return "Minimum team size must be at least 1.";
        if ((formData.maxTeamSize ?? 1) < (formData.minTeamSize ?? 1)) return "Maximum team size cannot be smaller than the minimum.";
        if (formData.maxParticipants !== undefined && (formData.maxParticipants as number) < (formData.maxTeamSize ?? 1)) {
            return "Maximum participants cannot be smaller than max team size.";
        }
        return "";
    };

    const handleDateChange = (value: string) => {
        setDateInput(value);
        const stored = inputDateToStored(value);
        setFormData(prev => ({ ...prev, date: stored ?? "" }));
        setDateError("");
        if (!stored) return;
        const picked = new Date(value + "T00:00:00"); // local midnight — the chosen day, never UTC-shifted
        const now = new Date();
        if (picked < now && formData.status === "upcoming") {
            // Suggest instead of silently switching; the admin keeps control.
            if (confirm("This date is in the past. Switch status to 'Past'?")) {
                setFormData(prev => ({ ...prev, status: "past" }));
            }
        } else if (picked > now && formData.status === "past") {
            setFormData(prev => ({ ...prev, status: "upcoming" }));
        }
    };

    const handleTimeChange = (which: "start" | "end", value: string) => {
        const next = { ...timeRange, [which]: value || null };
        setTimeRange(next);
        setFormData(prev => ({ ...prev, time: inputTimeToStored(next.start, next.end) }));
        // Valid range check only when both bounds exist ("HH:MM" strings compare chronologically).
        if (next.start && next.end && next.start >= next.end) {
            setTimeError("End time must be after the start time.");
        } else {
            setTimeError("");
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const problem = validate();
        if (problem || timeError) {
            setDateError(problem.includes("date") ? problem : "");
            setTeamSizeError(problem.includes("team size") ? problem : "");
            toast.warning(timeError || problem);
            return;
        }
        setLoading(true);

        try {
            if (isEdit && initialData?.id) {
                await updateEvent(initialData.id, formData);
            } else {
                await createEvent(formData);
            }
            router.push("/admin/events");
            router.refresh();
        } catch (error) {
            console.error("Failed to save event", error);
            toast.error("Failed to save event. Check console.");
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 bg-white/5 p-6 md:p-8 rounded-xl border border-white/10">

            {/* Smart Feature Banner */}
            {!isEdit && (
                <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg flex items-center gap-2 text-sm text-blue-300">
                    <Sparkles size={16} />
                    <span>Pro tip: entering a past date offers to switch the status to Past automatically.</span>
                </div>
            )}

            <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                <ImageUpload
                    path="event-images"
                    currentImage={formData.image}
                    onUpload={(url) => setFormData(prev => ({ ...prev, image: url }))}
                />
            </div>

            <div>
                <label htmlFor="event-title" className="block text-sm font-bold text-gray-400 mb-2">Event Title <span aria-hidden="true" className="text-blue-400">*</span></label>
                <input
                    id="event-title"
                    type="text"
                    required
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="event-date" className="block text-sm font-bold text-gray-400 mb-2">Date <span aria-hidden="true" className="text-blue-400">*</span></label>
                    <div className="relative cursor-pointer" onClick={e => {
                        e.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                    }}>
                        <input
                            id="event-date"
                            type="date"
                            required
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pl-10 [color-scheme:dark]"
                            value={dateInput}
                            onChange={e => handleDateChange(e.target.value)}
                            aria-invalid={!!dateError}
                            aria-describedby={dateError ? "event-date-error" : undefined}
                        />
                        <button
                            type="button"
                            onClick={e => {
                            e.stopPropagation();
                            e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                            }}
                            aria-label="Open date picker"
                            className="absolute left-3 top-3.5 p-1 text-gray-500 hover:text-white transition-colors"
                        >
                            <Calendar size={16} aria-hidden="true" />
                        </button>
                    </div>
                    {dateError && (
                        <p id="event-date-error" role="alert" className="text-red-400 text-xs mt-1.5">{dateError}</p>
                    )}
                </div>
                <div>
                    <label htmlFor="event-status" className="block text-sm font-bold text-gray-400 mb-2">Status</label>
                    <select
                        id="event-status"
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value as Event["status"] })}
                    >
                        <option value="upcoming">Upcoming</option>
                        <option value="ongoing">Ongoing (shown as live)</option>
                        <option value="past">Past</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="event-time-start" className="block text-sm font-bold text-gray-400 mb-2 flex items-center gap-1.5"><Clock size={13} aria-hidden="true" /> Time</label>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="event-time-start" className="sr-only">Start time</label>
                            <input
                                id="event-time-start"
                                type="time"
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
                                value={timeRange.start ?? ""}
                                onChange={e => handleTimeChange("start", e.target.value)}
                                aria-invalid={!!timeError}
                            />
                            <p className="text-xs text-gray-500 mt-1">Start</p>
                        </div>
                        <div>
                            <label htmlFor="event-time-end" className="sr-only">End time</label>
                            <input
                                id="event-time-end"
                                type="time"
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
                                value={timeRange.end ?? ""}
                                onChange={e => handleTimeChange("end", e.target.value)}
                                aria-invalid={!!timeError}
                                aria-describedby={timeError ? "event-time-error" : undefined}
                            />
                            <p className="text-xs text-gray-500 mt-1">End</p>
                        </div>
                    </div>
                    {timeError && (
                        <p id="event-time-error" role="alert" className="text-red-400 text-xs mt-1.5">{timeError}</p>
                    )}
                </div>
                <div>
                    <label htmlFor="event-venue" className="block text-sm font-bold text-gray-400 mb-2">Venue</label>
                    <input
                        id="event-venue"
                        type="text"
                        placeholder="e.g. Auditorium, Block A"
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={formData.venue}
                        onChange={e => setFormData({ ...formData, venue: e.target.value })}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="event-min-team" className="block text-sm font-bold text-gray-400 mb-2">Min Team Size</label>
                    <input
                        id="event-min-team"
                        type="number"
                        min={1}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={formData.minTeamSize || 1}
                        onChange={e => setFormData({ ...formData, minTeamSize: Number.parseInt(e.target.value) || 1 })}
                    />
                </div>
                <div>
                    <label htmlFor="event-max-team" className="block text-sm font-bold text-gray-400 mb-2">Max Team Size</label>
                    <input
                        id="event-max-team"
                        type="number"
                        min={1}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={formData.maxTeamSize || 1}
                        onChange={e => setFormData({ ...formData, maxTeamSize: Number.parseInt(e.target.value) || 1 })}
                        aria-invalid={!!teamSizeError}
                        aria-describedby={teamSizeError ? "event-team-size-error" : undefined}
                    />
                    {teamSizeError ? (
                        <p id="event-team-size-error" role="alert" className="text-red-400 text-xs mt-1.5">{teamSizeError}</p>
                    ) : (
                        <p className="text-xs text-gray-500 mt-1">Set to 1 for individual events.</p>
                    )}
                </div>
            </div>

            {/* Max Participants & Waitlist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="event-max-participants" className="block text-sm font-bold text-gray-400 mb-2">Max Participants</label>
                    <input
                        id="event-max-participants"
                        type="number"
                        min={1}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={formData.maxParticipants ?? ""}
                        onChange={e => {
                            const v = e.target.value;
                            setFormData(prev => ({ ...prev, maxParticipants: v === "" ? undefined : Number.parseInt(v) || undefined }));
                        }}
                        placeholder="No limit"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leave empty for unlimited. Registrations beyond this go to waitlist (if enabled).</p>
                </div>
                <div className="flex flex-col md:flex-row md:items-end gap-4 bg-black/20 p-4 rounded-xl border border-white/5">
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={formData.enableWaitlist}
                            onChange={() => setFormData(prev => ({ ...prev, enableWaitlist: !prev.enableWaitlist }))}
                            className="peer sr-only"
                        />
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${formData.enableWaitlist ? "border-blue-500 bg-blue-500/20" : "border-gray-500 group-hover:border-gray-400"}`} aria-hidden="true">
                            {formData.enableWaitlist && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                        </div>
                        <span className={`text-sm transition-colors ${formData.enableWaitlist ? "text-white" : "text-gray-400 group-hover:text-gray-300"}`}>Enable Waitlist</span>
                    </label>
                    {formData.enableWaitlist && (
                        <span className="text-[10px] text-blue-400">Waitlist: registrations above Max Participants are waitlisted.</span>
                    )}
                    {!formData.enableWaitlist && (
                        <span className="text-[10px] text-gray-500">Waitlist disabled: registrations beyond Max Participants are blocked.</span>
                    )}
                </div>
            </div>

            <div>
                <label htmlFor="event-short-desc" className="block text-sm font-bold text-gray-400 mb-2">Short Description <span className="text-gray-600 font-normal" aria-hidden="true">shown on event cards</span></label>
                <input
                    id="event-short-desc"
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                />
            </div>

            <div>
                {/* Markdown editor with Write/Preview tabs; renders publicly
                    through the shared Markdown component so preview === public. */}
                <MarkdownEditor
                    id="event-full-details"
                    label="Full Details (Markdown)"
                    value={formData.fullDescription}
                    onChange={value => setFormData({ ...formData, fullDescription: value })}
                    rows={8}
                    placeholder="# Event Agenda\n\n- Introduction\n- Keynote\n- Networking"
                />
            </div>

            <div>
                <MarkdownEditor
                    id="event-key-points"
                    label="Key Points / Agenda (One per line)"
                    value={formData.details ? formData.details.join('\n') : ''}
                    onChange={value => setFormData({ ...formData, details: value.split('\n') })}
                    rows={5}
                    placeholder="Time: 10:00 AM\nVenue: Auditorium\nSpeaker: Dr. Smith"
                    helpHint="One highlight per line — Markdown (bold, links, code) works inside each line."
                    helpExamples={['**Time:** 10:00 AM', 'Venue: **Auditorium**', 'Speaker: [Dr. Smith](https://example.com)']}
                    previewAsList
                />
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-end gap-4">
                <Link href="/admin/events" className="px-6 py-3 rounded-lg text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                    <X size={18} /> Cancel
                </Link>
                <button
                    type="submit"
                    disabled={loading}
                    className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
                >
                    <Save size={18} />
                    {loading ? "Saving..." : isEdit ? "Update Event" : "Create Event"}
                </button>
            </div>
        </form>
    );
}
