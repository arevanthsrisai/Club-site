"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import FormBuilder, { draftFromForm } from "@/components/admin/FormsFormBuilder";
import PageHeader from "@/components/ui/PageHeader";
import { subscribeToForm } from "@/services/forms";
import type { Form } from "@/types/forms";
import { ClipboardList, CloudOff } from "lucide-react";

export default function EditFormPage() {
    const params = useParams<{ id: string }>();
    const [form, setForm] = useState<Form | null>(null);
    const [missing, setMissing] = useState(false);
    const [loading, setLoading] = useState(true);

    // One read to hydrate the builder; admins also get live doc updates after
    // saving from another tab through the same subscription.
    useEffect(() => {
        if (!params.id) return;
        const unsub = subscribeToForm(
            params.id,
            (f, isMissing) => {
                setForm(f);
                setMissing(isMissing && !f);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return unsub;
    }, [params.id]);

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <PageHeader
                title="Edit Form"
                subtitle="Update fields, availability and status. Changes apply to new submissions immediately."
                icon={<ClipboardList size={26} />}
            />
            {loading ? (
                <div className="space-y-2" role="status" aria-label="Loading form">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" style={{ opacity: 1 - i * 0.2 }} />
                    ))}
                </div>
            ) : missing || !form ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-8 text-center">
                    <p className="text-red-300 font-semibold flex items-center justify-center gap-2">
                        <CloudOff size={16} aria-hidden="true" /> Form not found
                    </p>
                    <p className="text-sm text-gray-400 mt-1">It may have been deleted by another admin.</p>
                </div>
            ) : (
                <FormBuilder key={form.id} initial={{ id: form.id, draft: draftFromForm(form) }} />
            )}
        </div>
    );
}
