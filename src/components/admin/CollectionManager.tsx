"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, deleteDoc, doc, query, limit, onSnapshot, setDoc, addDoc } from "firebase/firestore";
import { Trash2, X, AlertTriangle, Loader2, Plus, Save, Edit2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface CollectionManagerProps {
    collectionName: string;
    onClose: () => void;
    /** Rules deny client writes for this collection (server routes own it), so
     *  the create/edit/delete controls are hidden instead of failing on save. */
    readOnly?: boolean;
}

export default function CollectionManager({ collectionName, onClose, readOnly = false }: CollectionManagerProps) {
    const canWrite = !readOnly;
    const [docs, setDocs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const { toast } = useToast();

    // Editor state
    const [isEditing, setIsEditing] = useState(false);
    const [editJson, setEditJson] = useState("");
    
    const [isCreating, setIsCreating] = useState(false);
    const [newDocId, setNewDocId] = useState("");
    const [newDocJson, setNewDocJson] = useState("{\n  \n}");
    
    const [saving, setSaving] = useState(false);

    // Multi-select state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeletingMultiple, setIsDeletingMultiple] = useState(false);

    useEffect(() => {
        setLoading(true);
        setSelectedDoc(null);
        setIsEditing(false);
        setIsCreating(false);
        setSelectedIds(new Set());
        
        const q = query(collection(db, collectionName), limit(100));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
            setDocs(data);
            setLoading(false);
        }, (error) => {
            console.error("Error loading docs:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [collectionName]);

    const handleDelete = async (id: string) => {
        if (!confirm(`Are you SURE you want to delete document ${id} from ${collectionName}? This cannot be undone.`)) return;

        setDeletingId(id);
        try {
            await deleteDoc(doc(db, collectionName, id));
            // Snapshot handles local update
            if (selectedDoc?.id === id) {
                setSelectedDoc(null);
                setIsEditing(false);
            }
            if (selectedIds.has(id)) {
                const next = new Set(selectedIds);
                next.delete(id);
                setSelectedIds(next);
            }
        } catch (error: any) {
            console.error("Delete failed:", error);
            toast("Delete failed: " + error.message, "error");
        } finally {
            setDeletingId(null);
        }
    };

    const handleDeleteMultiple = async () => {
        if (!confirm(`Are you SURE you want to delete ${selectedIds.size} documents from ${collectionName}? This cannot be undone.`)) return;
        
        setIsDeletingMultiple(true);
        let successCount = 0;
        try {
            for (const id of Array.from(selectedIds)) {
                await deleteDoc(doc(db, collectionName, id));
                successCount++;
            }
            toast(`Successfully deleted ${successCount} documents`, "success");
            setSelectedIds(new Set());
            if (selectedDoc && selectedIds.has(selectedDoc.id)) {
                setSelectedDoc(null);
                setIsEditing(false);
            }
        } catch (error: any) {
            console.error("Bulk delete failed:", error);
            toast(`Failed after deleting ${successCount} documents: ${error.message}`, "error");
        } finally {
            setIsDeletingMultiple(false);
        }
    };

    const handleEditStart = (docData: any) => {
        const { id, ...rest } = docData;
        setEditJson(JSON.stringify(rest, null, 2));
        setIsEditing(true);
        setIsCreating(false);
        setSelectedDoc(docData);
    };

    const handleCreateStart = () => {
        setNewDocId("");
        setNewDocJson("{\n  \n}");
        setIsCreating(true);
        setIsEditing(false);
        setSelectedDoc(null);
    };

    const handleSaveEdit = async () => {
        if (!selectedDoc) return;
        try {
            setSaving(true);
            const parsed = JSON.parse(editJson);
            await setDoc(doc(db, collectionName, selectedDoc.id), parsed);
            toast("Document updated successfully", "success");
            setIsEditing(false);
            setSelectedDoc(null); // Close inspector to refresh
        } catch (e: any) {
            toast("Invalid JSON or save failed: " + e.message, "error");
        } finally {
            setSaving(false);
        }
    };

    const handleSaveNew = async () => {
        try {
            setSaving(true);
            const parsed = JSON.parse(newDocJson);
            if (newDocId.trim()) {
                await setDoc(doc(db, collectionName, newDocId.trim()), parsed);
            } else {
                await addDoc(collection(db, collectionName), parsed);
            }
            toast("Document created successfully", "success");
            setIsCreating(false);
        } catch (e: any) {
            toast("Invalid JSON or create failed: " + e.message, "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-gray-900 border border-white/10 rounded-2xl overflow-hidden flex flex-col h-[600px] animate-in slide-in-from-bottom-5">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-black/40">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold font-mono text-blue-400">/{collectionName}</h2>
                    <span className="text-gray-500 text-sm">({docs.length} docs visible)</span>
                </div>
                <div className="flex items-center gap-2">
                    {readOnly && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-500/80 border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 rounded">
                            Read-only
                        </span>
                    )}
                    {canWrite && selectedIds.size > 0 && (
                        <button
                            onClick={handleDeleteMultiple}
                            disabled={isDeletingMultiple}
                            className="flex items-center gap-2 bg-red-600/20 text-red-500 border border-red-500/50 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-colors mr-2"
                        >
                            {isDeletingMultiple ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            Delete Selected ({selectedIds.size})
                        </button>
                    )}
                    {canWrite && (
                        <button
                            onClick={handleCreateStart}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-colors"
                        >
                            <Plus size={16} /> Add Document
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors ml-2"
                        title="Close"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex relative">
                {/* List View */}
                <div className={`flex-1 overflow-y-auto ${(selectedDoc || isCreating) ? 'hidden md:block md:w-1/2 border-r border-white/10' : 'w-full'}`}>
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-gray-400">
                            <Loader2 className="animate-spin mr-2" /> Loading data...
                        </div>
                    ) : docs.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-500 italic">
                            Collection is empty
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-white/5 text-xs uppercase text-gray-400 font-mono sticky top-0">
                                <tr>
                                    {canWrite && (
                                        <th className="p-3 w-10">
                                            <input 
                                                type="checkbox" 
                                                className="w-4 h-4 rounded border-gray-600 bg-black/40 text-blue-500 focus:ring-blue-500"
                                                checked={docs.length > 0 && selectedIds.size === docs.length}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedIds(new Set(docs.map(d => d.id)));
                                                    else setSelectedIds(new Set());
                                                }}
                                            />
                                        </th>
                                    )}
                                    <th className="p-3">Document ID</th>
                                    <th className="p-3">Summary</th>
                                    {canWrite && <th className="p-3 text-right">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 font-mono text-sm">
                                {docs.map((doc) => (
                                    <tr
                                        key={doc.id}
                                        className={`hover:bg-blue-500/5 transition-colors cursor-pointer ${selectedDoc?.id === doc.id ? 'bg-blue-500/10' : ''}`}
                                        onClick={() => {
                                            setSelectedDoc(doc);
                                            setIsEditing(false);
                                            setIsCreating(false);
                                        }}
                                    >
                                        {canWrite && (
                                            <td className="p-3">
                                                <input 
                                                    type="checkbox" 
                                                    className="w-4 h-4 rounded border-gray-600 bg-black/40 text-blue-500 focus:ring-blue-500"
                                                    checked={selectedIds.has(doc.id)}
                                                    onChange={(e) => {
                                                        const next = new Set(selectedIds);
                                                        if (e.target.checked) next.add(doc.id);
                                                        else next.delete(doc.id);
                                                        setSelectedIds(next);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </td>
                                        )}
                                        <td className="p-3 text-blue-300 truncate max-w-[150px]">{doc.id}</td>
                                        <td className="p-3 text-gray-400 truncate max-w-[200px]">
                                            {doc.name || doc.title || doc.email || doc.displayName || JSON.stringify(doc).slice(0, 30) + "..."}
                                        </td>
                                        {canWrite && (
                                            <td className="p-3 text-right">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleEditStart(doc); }}
                                                    className="text-gray-400 hover:text-blue-400 p-1 transition-colors mr-2"
                                                    aria-label={`Edit ${doc.id}`}
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                                                    className="text-gray-500 hover:text-red-500 p-1 transition-colors"
                                                    disabled={deletingId === doc.id}
                                                    aria-label={`Delete ${doc.id}`}
                                                >
                                                    {deletingId === doc.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Inspect/Edit View */}
                {(selectedDoc || isCreating) && (
                    <div className="w-full md:w-1/2 bg-black/20 overflow-y-auto p-4 absolute md:static inset-0 z-10 md:z-0 flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-gray-300">
                                {isCreating ? "Create Document" : isEditing ? "Edit Document" : "View Document"}
                            </h3>
                            <button 
                                onClick={() => {
                                    setSelectedDoc(null);
                                    setIsCreating(false);
                                    setIsEditing(false);
                                }} 
                                className="text-gray-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        {isCreating && (
                            <div className="mb-4">
                                <label className="block text-xs font-bold text-gray-400 mb-1">Document ID (Optional, leave blank for auto-ID)</label>
                                <input
                                    type="text"
                                    className="w-full bg-black/60 border border-white/10 rounded-lg p-2 font-mono text-sm text-blue-300 focus:border-blue-500 outline-none"
                                    placeholder="Auto-generated ID"
                                    value={newDocId}
                                    onChange={(e) => setNewDocId(e.target.value)}
                                />
                            </div>
                        )}

                        {selectedDoc && !isEditing && !isCreating && (
                            <div className="mb-4">
                                <label className="block text-xs font-bold text-gray-400 mb-1">Document ID</label>
                                <div className="w-full bg-black/40 border border-white/5 rounded-lg p-2 font-mono text-sm text-blue-300">
                                    {selectedDoc.id}
                                </div>
                            </div>
                        )}

                        <label className="block text-xs font-bold text-gray-400 mb-1">Document Data (JSON)</label>
                        {isEditing ? (
                            <textarea
                                className="text-xs text-green-400 font-mono whitespace-pre-wrap bg-black/60 p-4 rounded-lg border border-blue-500/50 flex-1 overflow-auto outline-none resize-none focus:ring-1 focus:ring-blue-500"
                                value={editJson}
                                onChange={(e) => setEditJson(e.target.value)}
                            />
                        ) : isCreating ? (
                            <textarea
                                className="text-xs text-green-400 font-mono whitespace-pre-wrap bg-black/60 p-4 rounded-lg border border-blue-500/50 flex-1 overflow-auto outline-none resize-none focus:ring-1 focus:ring-blue-500"
                                value={newDocJson}
                                onChange={(e) => setNewDocJson(e.target.value)}
                            />
                        ) : (
                            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap bg-black/50 p-4 rounded-lg border border-white/5 flex-1 overflow-auto">
                                {JSON.stringify((({ id, ...rest }) => rest)(selectedDoc), null, 2)}
                            </pre>
                        )}

                        <div className="mt-4 flex justify-end gap-2">
                            {isEditing ? (
                                <>
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveEdit}
                                        disabled={saving}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-bold text-sm disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        Save Changes
                                    </button>
                                </>
                            ) : isCreating ? (
                                <>
                                    <button
                                        onClick={() => setIsCreating(false)}
                                        className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveNew}
                                        disabled={saving}
                                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors font-bold text-sm disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        Create Document
                                    </button>
                                </>
                            ) : canWrite ? (
                                <>
                                    <button
                                        onClick={() => handleDelete(selectedDoc.id)}
                                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors text-sm"
                                    >
                                        <Trash2 size={16} /> Delete
                                    </button>
                                    <button
                                        onClick={() => handleEditStart(selectedDoc)}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/50 text-blue-400 hover:bg-blue-500 hover:text-white rounded-lg transition-colors text-sm"
                                    >
                                        <Edit2 size={16} /> Edit
                                    </button>
                                </>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>

            <div className="p-2 border-t border-white/10 bg-yellow-500/5 text-yellow-500/70 text-xs flex items-center justify-center gap-2">
                <AlertTriangle size={12} />
                {readOnly
                    ? "Rules deny client writes to this collection — it is written by server routes only."
                    : "Changes here are immediate and irreversible. Proceed with caution."}
            </div>
        </div>
    );
}
