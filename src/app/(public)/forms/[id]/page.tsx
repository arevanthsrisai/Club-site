"use client";

/**
 * Public form submission page — /forms/[id].
 *
 * Draft and closed forms are not readable by the rules, so a signed-out
 * visitor sees "not available". The server re-validates availability,
 * answers and duplicates on submit, so nothing here can be bypassed by
 * calling the API directly.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { subscribeToForm, submitFormAnswers, ApiError } from "@/services/forms";
import { computeAvailability, AVAILABILITY_MESSAGE, validateSubmission } from "@/lib/forms";
import { useAuth } from "@/lib/auth";
import FormRenderer, { type RendererValues } from "@/components/forms/FormRenderer";
import type { Form } from "@/types/forms";
import { Loader2 } from "lucide-react";
import {
    CalendarClock, CheckCircle2, ClipboardList, ArrowLeft, Lock,
    AlertTriangle, Send,
} from "lucide-react";

type Phase = "loading" | "unavailable" | "ready" | "submitting" | "success" | "error";

export default function PublicFormPage() {
    const params = useParams<{ id: string }>();
    const formId = params?.id as string;
    const { user } = useAuth();

    const [form, setForm] = useState<Form | null>(null);
    const [missing, setMissing] = useState(false);
    const [phase, setPhase] = useState<Phase>("loading");
    const [values, setValues] = useState<RendererValues>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [globalError, setGlobalError] = useState("");

    useEffect(() => {
        if (!formId) return;
        const unsub = subscribeToForm(
            formId,
            (data, gone) => {
                setForm(data);
                setMissing(gone || !data);
                setPhase(prev => (prev === "loading" ? "ready" : prev));
            },
            () => { setPhase(prev => (prev === "loading" ? "unavailable" : prev)); }
        );
        return () => unsub();
    }, [formId]);

    const availability = useMemo(() => (form ? computeAvailability(form) : "draft"), [form]);
    const open = availability === "open";

    const setField = (fieldId: string, value: string | number | boolean | string[]) => {
        setValues(prev => ({ ...prev, [fieldId]: value }));
        setErrors(prev => (prev[fieldId] ? { ...prev, [fieldId]: "" } : prev));
    };

    const blurField = (fieldId: string) => {
        if (!form) return;
        const field = form.fields.find(f => f.id === fieldId);
        if (!field?.required) return;
        const errs = validateSubmission({ fields: [field] }, { [fieldId]: values[fieldId] });
        setErrors(prev => ({ ...prev, [fieldId]: errs[fieldId] ?? "" }));
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!form) return;
        const fieldErrors = validateSubmission(form, values);
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(fieldErrors)) if (v) clean[k] = v;
        setErrors(clean);
        if (Object.keys(clean).length > 0) {
            setGlobalError("Please fix the highlighted fields.");
            return;
        }
        setGlobalError("");
        setPhase("submitting");
        try {
            await submitFormAnswers(formId, values);
            setPhase("success");
        } catch (err) {
            if (err instanceof ApiError) {
                if (err.code === "ALREADY_SUBMITTED") { setPhase("success"); return; }
                const typed = (err as ApiError & { fieldErrors?: Record<string, string> }).fieldErrors;
                if (typed) {
                    setErrors(typed);
                    setGlobalError("Please fix the highlighted fields.");
                    setPhase("ready");
                    return;
                }
                setGlobalError(err.message);
            } else {
                setGlobalError("Something went wrong. Please try again.");
            }
            setPhase("ready");
        }
    };

    if (phase === "loading") return (
        <div className="min-h-screen pt-32 flex flex-col items-center justify-center gap-4">
            <Loader2 size={40} className="animate-spin text-blue-500" aria-hidden="true" />
            <p className="text-gray-400 text-sm">Loading form…</p>
        </div>
    );

    if (missing || !form) return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
            <ClipboardList size={40} className="text-gray-500" aria-hidden="true" />
            <h1 className="text-xl font-bold text-white">Form not found</h1>
            <p className="text-sm text-gray-400">This form may have been unpublished or removed.</p>
            <Link href="/forms" className="rounded-full bg-white/10 border border-white/10 px-5 py-2 text-sm font-semibold text-white hover:bg-white/20 transition-colors">
                Browse open forms
            </Link>
        </div>
    );

    if (phase === "success") return (
        <div className="min-h-[55vh] flex flex-col items-center justify-center gap-4 text-center px-4">
            <CheckCircle2 size={56} className="text-green-500" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-white">Response received!</h1>
            <p className="text-sm text-gray-400 max-w-md">
                Thanks — your submission has been recorded. You can safely close this page.
            </p>
            <Link href="/forms" className="rounded-full bg-blue-500/20 border border-blue-500/40 px-5 py-2 text-sm font-semibold text-blue-300 hover:bg-blue-500/30 transition-colors">
                Back to forms
            </Link>
        </div>
    );

    if (!open) return (
        <div className="min-h-[55vh] flex flex-col items-center justify-center gap-4 text-center px-4">
            {availability === "not-yet-open"
                ? <CalendarClock size={40} className="text-amber-500" aria-hidden="true" />
                : <Lock size={40} className="text-gray-500" aria-hidden="true" />}
            <h1 className="text-xl font-bold text-white">{form.title}</h1>
            <p className="text-sm text-gray-400">{AVAILABILITY_MESSAGE[availability]}</p>
            <Link href="/forms" className="rounded-full bg-white/10 border border-white/10 px-5 py-2 text-sm font-semibold text-white hover:bg-white/20 transition-colors">
                Browse open forms
            </Link>
        </div>
    );

    return (
        <div className="px-4 pb-20 pt-8 sm:px-6">
            <Link href="/forms" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6">
                <ArrowLeft size={16} aria-hidden="true" /> All forms
            </Link>

            <div className="mx-auto max-w-2xl">
                <div className="rounded-3xl border border-white/10 bg-black/30 p-5 sm:p-8">
                    <form onSubmit={handleSubmit} noValidate>
                        <h1 className="text-2xl font-bold text-white">{form.title}</h1>
                        {form.description && <p className="mt-2 text-sm text-gray-400 whitespace-pre-wrap">{form.description}</p>}
                        {form.closesAt && (
                            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-400">
                                <CalendarClock size={13} aria-hidden="true" />
                                Deadline: {new Date(form.closesAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            </p>
                        )}

                        <div className="h-px bg-white/10 my-6" />

                        <FormRenderer
                            form={form}
                            values={values}
                            errors={errors}
                            onValueChange={setField}
                            onBlur={blurField}
                            disabled={phase !== "ready"}
                        />

                        {(globalError || Object.values(errors).some(Boolean)) && phase !== "error" && globalError && (
                            <div role="alert" className="mt-5 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
                                {globalError}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-blue-500 px-6 py-3 font-bold text-white transition-colors hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-60"
                            disabled={phase !== "ready"}
                        >
                            <Send size={16} aria-hidden="true" />
                            {phase === "submitting" ? "Submitting…" : "Submit response"}
                        </button>
                        {!user && (
                            <p className="mt-3 text-center text-xs text-gray-500">Submit while signed in to keep your answers linked to your account.</p>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
}
