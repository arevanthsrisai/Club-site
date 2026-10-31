"use client";

import { useState, useEffect } from "react";
import { Alumni } from "@/types";
import { subscribeToAlumni, createAlumni, updateAlumni, deleteAlumni } from "@/lib/api";
import { GraduationCap, Plus, Trash2, Edit3, X, Save, Linkedin, Briefcase, Building2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import PageHeader from "@/components/ui/PageHeader";

const EMPTY_FORM = {
    name: "",
    batchYear: "",
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
    const { toast } = useToast();

    useEffect(() => {
        const unsubscribe = subscribeToAlumni((data) => {
            setAlumni(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const resetForm = () => {
        setForm(EMPTY_FORM);
        setEditingId(null);
        setShowForm(false);
    };

    const handleEdit = (alumnus: Alumni) => {
        setForm({
            name: alumnus.name,
            batchYear: alumnus.batchYear,
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
        if (!form.name || !form.batchYear || !form.roleHeld) {
            toast("Please fill in Name, Batch Year, and Role Held.", "error");
            return;
        }

        setSaving(true);
        try {
            if (editingId) {
                await updateAlumni(editingId, form);
                toast("Alumni profile updated successfully!", "success");
            } else {
                await createAlumni(form);
                toast("Alumni profile added successfully!", "success");
            }
            resetForm();
        } catch (err: any) {
            console.error(err);
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
                subtitle={`${alumni.length} alumni profiles`}
                icon={<GraduationCap size={26} />}
                actions={
                    <button
                        onClick={() => { resetForm(); setShowForm(true); }}
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
                        <button onClick={resetForm} className="text-gray-400 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Name *</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. John Doe"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Batch Year *</label>
                            <input
                                type="text"
                                value={form.batchYear}
                                onChange={(e) => setForm({ ...form, batchYear: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. 2020-2024"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Role Held in ReLU *</label>
                            <input
                                type="text"
                                value={form.roleHeld}
                                onChange={(e) => setForm({ ...form, roleHeld: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. President, VP, CTO"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Current Position</label>
                            <input
                                type="text"
                                value={form.currentPosition}
                                onChange={(e) => setForm({ ...form, currentPosition: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. Software Engineer"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Company</label>
                            <input
                                type="text"
                                value={form.company}
                                onChange={(e) => setForm({ ...form, company: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="e.g. Google, Microsoft"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">LinkedIn URL</label>
                            <input
                                type="url"
                                value={form.linkedinUrl}
                                onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="https://linkedin.com/in/..."
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm text-gray-400 mb-1">Photo URL</label>
                            <input
                                type="url"
                                value={form.photoURL}
                                onChange={(e) => setForm({ ...form, photoURL: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none"
                                placeholder="https://... (optional)"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <button onClick={resetForm} className="px-5 py-2.5 text-gray-400 hover:text-white transition-colors">
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

            {/* Alumni List */}
            {alumni.length === 0 ? (
                <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/10">
                    <GraduationCap size={48} className="mx-auto text-gray-600 mb-4" />
                    <p className="text-xl text-gray-400">No alumni profiles yet.</p>
                    <p className="text-sm text-gray-500 mt-2">Click &quot;Add Alumni&quot; to get started.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {alumni.map((alumnus) => (
                        <div key={alumnus.id} className="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all group">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    {alumnus.photoURL ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={alumnus.photoURL} alt={alumnus.name} loading="lazy" decoding="async" className="w-12 h-12 rounded-full object-cover border border-white/10" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                                            {alumnus.name.charAt(0)}
                                        </div>
                                    )}
                                    <div>
                                        <h3 className="font-bold text-white">{alumnus.name}</h3>
                                        <p className="text-xs text-blue-400 font-medium">{alumnus.roleHeld}</p>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleEdit(alumnus)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-blue-400 transition-colors">
                                        <Edit3 size={14} />
                                    </button>
                                    <button onClick={() => handleDelete(alumnus.id, alumnus.name)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-1.5 text-sm text-gray-400">
                                <p className="flex items-center gap-2">
                                    <GraduationCap size={14} className="text-gray-500" />
                                    Batch: {alumnus.batchYear}
                                </p>
                                {alumnus.currentPosition && (
                                    <p className="flex items-center gap-2">
                                        <Briefcase size={14} className="text-gray-500" />
                                        {alumnus.currentPosition}
                                    </p>
                                )}
                                {alumnus.company && (
                                    <p className="flex items-center gap-2">
                                        <Building2 size={14} className="text-gray-500" />
                                        {alumnus.company}
                                    </p>
                                )}
                                {alumnus.linkedinUrl && (
                                    <a href={alumnus.linkedinUrl} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                        <Linkedin size={14} /> LinkedIn
                                    </a>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
