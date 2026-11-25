"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alumni } from "@/types";
import { subscribeToAlumni, createAlumni, updateAlumni, deleteAlumni } from "@/lib/api";
import {
    ALUMNI_MIN_JOINING_YEAR,
    alumniJoiningYear,
    batchLabelFromJoiningYear,
    groupAlumniByBatch,
    normalizeJoiningYear,
} from "@/lib/alumni";
import { GraduationCap, Plus, Trash2, Edit3, X, Save, Linkedin, Briefcase, Building2, ChevronDown } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import PageHeader from "@/components/ui/PageHeader";
import ImageField from "@/components/admin/ImageField";
import { discardDraftAsset } from "@/lib/imageStashClient";

const EMPTY_FORM = {
    name: "",
    joiningYear: "",
    roleHeld: "",
    currentPosition: "",
    company: "",
    linkedinUrl: "",
    photoURL: "",
};

export default function AdminAlumniPage() {
    const [alumni, setAlumni] = useState<Alumni[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    // Assets uploaded by this form session. They are discarded when the form
    // is cancelled or saved, so an abandoned profile never leaves orphans.
    const [draftAssetIds, setDraftAssetIds] = useState<string[]>([]);
    // Mirror of the drafts for unmount cleanup (state is stale inside cleanup).
    const draftAssetIdsRef = useRef<string[]>([]);
    const { toast } = useToast();

    const currentYear = new Date().getFullYear();
    const groups = useMemo(() => groupAlumniByBatch(alumni), [alumni]);

    // Live preview of the batch derived from what is typed. The admin never
    // enters a batch label; the joining year is the only date input.
    const previewJoiningYear = normalizeJoiningYear(form.joiningYear);
    const previewBatch = previewJoiningYear !== null ? batchLabelFromJoiningYear(previewJoiningYear) : "";

    useEffect(() => {
        draftAssetIdsRef.current = draftAssetIds;
    }, [draftAssetIds]);

    useEffect(() => {
        const unsubscribe = subscribeToAlumni((data) => {
            setAlumni(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Leaving the page with an unsaved upload must not strand the object.
    // The server refuses to delete anything a profile already references.
    useEffect(() => () => {
        draftAssetIdsRef.current.forEach(id => void discardDraftAsset(id));
    }, []);

    const resetForm = () => {
        setForm(EMPTY_FORM);
        setEditingId(null);
        setShowForm(false);
    };

    /** Best-effort cleanup; the server refuses to delete a referenced asset. */
    const discardDrafts = (ids: string[]) => {
        ids.forEach(id => void discardDraftAsset(id));
    };

    const discardDraft = (assetId: string) => {
        if (!draftAssetIds.includes(assetId)) return;
        setDraftAssetIds(prev => prev.filter(id => id !== assetId));
        void discardDraftAsset(assetId);
    };

    const cancelForm = () => {
        discardDrafts(draftAssetIds);
        setDraftAssetIds([]);
        resetForm();
    };

    const handleEdit = (alumnus: Alumni) => {
        // Never leave a previous unsaved upload behind.
        discardDrafts(draftAssetIds);
        setDraftAssetIds([]);
        setForm({
            name: alumnus.name,
            // Legacy records only had a free-text batch; read its first year so
            // editing starts from the same joining year the public page shows.
            joiningYear: String(alumniJoiningYear(alumnus) ?? ""),
            roleHeld: alumnus.roleHeld,
            currentPosition: alumnus.currentPosition || "",
            company: alumnus.company || "",
            linkedinUrl: alumnus.linkedinUrl || "",
            photoURL: alumnus.photoURL || "",
        });
        setEditingId(alumnus.id);
        setShowForm(true);
    };

    const handleSubmit = async () => {
        const joiningYear = normalizeJoiningYear(form.joiningYear);
        if (!form.name.trim() || joiningYear === null || !form.roleHeld.trim()) {
            toast("Please fill in Name, a valid Joining Year, and Role Held.", "error");
            return;
        }

        // batchYear is stored alongside joiningYear so older clients and
        // exports keep working; it is always derived, never hand-entered.
        const payload = {
            name: form.name.trim(),
            joiningYear,
            batchYear: batchLabelFromJoiningYear(joiningYear),
            roleHeld: form.roleHeld.trim(),
            currentPosition: form.currentPosition.trim(),
            company: form.company.trim(),
            linkedinUrl: form.linkedinUrl.trim(),
            photoURL: form.photoURL.trim(),
        };

        setSaving(true);
        try {
            if (editingId) {
                await updateAlumni(editingId, payload);
                toast("Alumni profile updated successfully!", "success");
            } else {
                await createAlumni(payload);
                toast("Alumni profile added successfully!", "success");
            }
            // The profile now references the assets; they are no longer drafts.
            setDraftAssetIds([]);
            resetForm();
        } catch (err: any) {
            console.error(err);
            // Keep the form (and its uploaded images) so the admin can retry;
            // cancelling later discards anything still unsaved.
            toast("Failed to save alumni profile. " + err.message, "error");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Are you sure you want to remove ${name} from alumni?`)) return;
        try {
            await deleteAlumni(id);
            toast(`${name} removed from alumni.`, "success");
        } catch (err: any) {
            toast("Failed to delete: " + err.message, "error");
        }
    };

    if (loading) return <div className="text-white p-8">Loading alumni...</div>;

    return (
        <div className="max-w-6xl mx-auto text-white">
            {/* Header */}
            <PageHeader
                title="Alumni Management"
                subtitle={
                    alumni.length === 0
                        ? "No alumni profiles yet"
                        : `${alumni.length} ${alumni.length === 1 ? "profile" : "profiles"} across ${groups.length} ${groups.length === 1 ? "batch" : "batches"}`
                }
                icon={<GraduationCap size={26} />}
                actions={
                    <button
                        onClick={() => {
                            discardDrafts(draftAssetIds);
                            setDraftAssetIds([]);
                            resetForm();
                            setShowForm(true);
                        }}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-colors shadow-lg shadow-blue-500/20"
                    >
                        <Plus size={18} /> Add Alumni
                    </button>
                }
            />

            {/* Add/Edit Form */}
            {showForm && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8 animate-in slide-in-from-top-5">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">
                            {editingId ? "Edit Alumni" : "Add New Alumni"}
                        </h2>
                        <button onClick={cancelForm} className="text-gray-400 hover:text-white" aria-label="Close form">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="alumni-name" className="block text-sm text-gray-400 mb-1">Name *</label>
                            <input
                                id="alumni-name"
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. John Doe"
                            />
                        </div>
                        <div>
                            <label htmlFor="alumni-joining-year" className="block text-sm text-gray-400 mb-1">Joining Year *</label>
                            <input
                                id="alumni-joining-year"
                                type="number"
                                inputMode="numeric"
                                min={ALUMNI_MIN_JOINING_YEAR}
                                max={currentYear}
                                step={1}
                                value={form.joiningYear}
                                onChange={(e) => setForm({ ...form, joiningYear: e.target.value })}
                                aria-describedby="alumni-joining-year-hint"
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. 2025"
                            />
                            <p id="alumni-joining-year-hint" aria-live="polite" className="text-xs text-gray-500 mt-1">
                                {previewBatch
                                    ? <>Batch <span className="text-blue-400 font-semibold">{previewBatch}</span> (4-year programme)</>
                                    : `Enter the year they joined (${ALUMNI_MIN_JOINING_YEAR}–${currentYear}); the batch is calculated automatically.`}
                            </p>
                        </div>
                        <div>
                            <label htmlFor="alumni-role" className="block text-sm text-gray-400 mb-1">Role Held in ReLU *</label>
                            <input
                                id="alumni-role"
                                type="text"
                                value={form.roleHeld}
                                onChange={(e) => setForm({ ...form, roleHeld: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. President, VP, CTO"
                            />
                        </div>
                        <div>
                            <label htmlFor="alumni-position" className="block text-sm text-gray-400 mb-1">Current Position</label>
                            <input
                                id="alumni-position"
                                type="text"
                                value={form.currentPosition}
                                onChange={(e) => setForm({ ...form, currentPosition: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. Software Engineer"
                            />
                        </div>
                        <div>
                            <label htmlFor="alumni-company" className="block text-sm text-gray-400 mb-1">Company</label>
                            <input
                                id="alumni-company"
                                type="text"
                                value={form.company}
                                onChange={(e) => setForm({ ...form, company: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. Google, Microsoft"
                            />
                        </div>
                        <div>
                            <label htmlFor="alumni-linkedin" className="block text-sm text-gray-400 mb-1">LinkedIn URL</label>
                            <input
                                id="alumni-linkedin"
                                type="url"
                                value={form.linkedinUrl}
                                onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="https://linkedin.com/in/..."
                            />
                        </div>
                        <div className="md:col-span-2">
                            <ImageField
                                value={form.photoURL}
                                onChange={(url) => setForm(prev => ({ ...prev, photoURL: url }))}
                                onCreateDraft={(id) => setDraftAssetIds(prev => prev.includes(id) ? prev : [...prev, id])}
                                onDiscardDraft={discardDraft}
                                label="Profile Image"
                                helpText="Upload a photo here — it is stored in the Image Stash automatically. You never need to paste a URL."
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <button onClick={cancelForm} className="px-5 py-2.5 text-gray-400 hover:text-white transition-colors">
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={saving}
                            className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-500 rounded-xl font-bold transition-colors disabled:opacity-50 shadow-lg shadow-green-500/20"
                        >
                            <Save size={16} /> {saving ? "Saving..." : editingId ? "Update" : "Add Alumni"}
                        </button>
                    </div>
                </div>
            )}

            {/* Alumni List — newest batch first, then name order inside a batch */}
            {alumni.length === 0 ? (
                <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/10">
                    <GraduationCap size={48} className="mx-auto text-gray-600 mb-4" />
                    <p className="text-xl text-gray-400">No alumni profiles yet.</p>
                    <p className="text-sm text-gray-500 mt-2">Click &quot;Add Alumni&quot; to get started.</p>
                </div>
            ) : (
                <div>
                    {groups.map((group) => (
                        <details
                            key={group.title}
                            className="mb-4 last:mb-0 bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden group"
                        >
                            <summary className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <GraduationCap size={18} className="text-blue-400" aria-hidden="true" />
                                    {group.title}
                                </h2>
                                <span className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500">
                                        {group.members.length} {group.members.length === 1 ? "member" : "members"}
                                    </span>
                                    <ChevronDown
                                        size={18}
                                        className="text-gray-500 transition-transform group-open:rotate-180"
                                        aria-hidden="true"
                                    />
                                </span>
                            </summary>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-5 pb-5">
                                {group.members.map((alumnus) => (
                                    <div
                                        key={alumnus.id}
                                        className="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all group flex flex-col h-full"
                                    >
                                        <div className="flex items-start justify-between gap-3 mb-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {alumnus.photoURL ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={alumnus.photoURL} alt={alumnus.name} loading="lazy" decoding="async" className="w-12 h-12 shrink-0 rounded-full object-cover border border-white/10" />
                                                ) : (
                                                    <div className="w-12 h-12 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                                                        {alumnus.name.charAt(0)}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <h3 className="font-bold text-white break-words">{alumnus.name}</h3>
                                                    <p className="text-xs text-blue-400 font-medium break-words">{alumnus.roleHeld}</p>
                                                </div>
                                            </div>

                                            {/* Actions stay reachable on touch devices (no hover). */}
                                            <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleEdit(alumnus)}
                                                    aria-label={`Edit ${alumnus.name}`}
                                                    className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-blue-400 transition-colors"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(alumnus.id, alumnus.name)}
                                                    aria-label={`Remove ${alumnus.name} from alumni`}
                                                    className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Batch is in the section heading, so cards stay clean. */}
                                        <div className="space-y-1.5 text-sm text-gray-400 mt-auto">
                                            {alumnus.currentPosition && (
                                                <p className="flex items-center gap-2 break-words">
                                                    <Briefcase size={14} className="text-gray-500 shrink-0" />
                                                    {alumnus.currentPosition}
                                                </p>
                                            )}
                                            {alumnus.company && (
                                                <p className="flex items-center gap-2 break-words">
                                                    <Building2 size={14} className="text-gray-500 shrink-0" />
                                                    {alumnus.company}
                                                </p>
                                            )}
                                            {alumnus.linkedinUrl && (
                                                <a href={alumnus.linkedinUrl} target="_blank" rel="noopener noreferrer"
                                                    className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
                                                >
                                                    <Linkedin size={14} className="shrink-0" /> LinkedIn
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </details>
                    ))}
                </div>
            )}
        </div>
    );
}
