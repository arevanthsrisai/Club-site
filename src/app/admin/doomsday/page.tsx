"use client";

import { useState } from "react";
import { useAuth, signOut } from "@/lib/auth";
import { transferCTORole } from "@/lib/api";
import { db, storage } from "@/lib/firebase"; // Import storage
import { collection, getDocs, deleteDoc, doc, query, where } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { getAuthHeaders } from "@/lib/authHeaders";
import { validateKey } from "@/lib/storageValidation";
import { Skull, AlertTriangle, Database, ShieldAlert, Shield, Folder, FolderKanban, Users, Calendar, Image as ImageIcon, BookOpen, MessageSquare, Settings, ChevronRight, X, Trash2, Eraser, RefreshCw, TerminalSquare, ClipboardList, FileText, KeyRound, History, UserCheck, Clock, GraduationCap, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import CollectionManager from "@/components/admin/CollectionManager";
import SettingsPanel from "@/components/admin/SettingsPanel";
import { useToast } from "@/components/ui/Toast";
import PageHeader from "@/components/ui/PageHeader";

export default function DoomsdayPage() {
    const { user, profile } = useAuth();
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [confirmText, setConfirmText] = useState("");

    // UI State
    const [showProtocol, setShowProtocol] = useState<"418" | "66" | "99" | "77" | null>(null); // 418=Transfer, 66=Purge, 99=Garbage, 77=Sync
    const [activeCollection, setActiveCollection] = useState<string | null>(null);
    const [purgeProgress, setPurgeProgress] = useState<string[]>([]);
    const { toast } = useToast();

    // Safety Check Component
    if (profile?.role !== "CTO") {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center text-white">
                <h1 className="text-4xl font-bold mb-4 text-gray-700">403 Forbidden</h1>
                <p className="text-gray-500">You are not authorized to view this page.</p>
            </div>
        );
    }

    const log = (msg: string) => {
        setPurgeProgress(prev => [...prev, msg]);
    };

    /**
     * Removes a member's stored avatar files.
     *
     * Media moved to the B2 bucket: avatars now live under the `profiles/…`
     * namespace and are addressed by a `/api/gallery/media?key=…` delivery URL,
     * so they can only be deleted through /api/admin/delete-b2 (the client SDK
     * has no handle on that bucket). Accounts created before the migration may
     * still hold a Firebase Storage object, keyed by uid or by download URL.
     */
    const deleteAvatarFiles = async (uid: string, photoURL?: string | null) => {
        try {
            await deleteObject(ref(storage, `profiles/${uid}`));
        } catch {
            // No legacy object for this account — expected for B2-era users.
        }
        if (!photoURL) return;

        if (photoURL.includes("firebasestorage.googleapis.com")) {
            try {
                await deleteObject(ref(storage, photoURL));
            } catch {
                // Already gone.
            }
            return;
        }

        // Preset avatars (/avatars/...) are app assets, not stored objects.
        let key = photoURL;
        if (key.includes("key=")) {
            try {
                key = new URL(key, window.location.origin).searchParams.get("key") ?? "";
            } catch {
                return;
            }
        }
        if (!validateKey(key)) return;

        try {
            const headers = await getAuthHeaders();
            if (!headers) return;
            await fetch("/api/admin/delete-b2", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...headers },
                body: JSON.stringify({ url: photoURL }),
            });
        } catch (error) {
            console.warn("Avatar object cleanup skipped:", error);
        }
    };

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (confirmText !== "TRANSFER ROLE") {
            toast("Please type TRANSFER ROLE to confirm.", "error");
            return;
        }

        if (!confirm("FINAL WARNING: You are about to transfer your CTO role. You will immediately lose CTO privileges. This action cannot be undone.")) {
            return;
        }

        setLoading(true);
        try {
            if (user?.uid) {
                await transferCTORole(user.uid, email);
                alert("Role transfer successful. You are no longer the CTO.");
                await signOut();
                router.push("/admin/login");
            }
        } catch (error: any) {
            console.error(error);
            toast("Transfer failed: " + error.message, "error");
        } finally {
            setLoading(false);
        }
    };

    const handlePurgeUsers = async () => {
        if (confirmText !== "EXECUTE ORDER 66") {
            toast("Please type EXECUTE ORDER 66 to confirm.", "error");
            return;
        }

        if (!confirm("FINAL WARNING: This will delete ALL public user profiles from the database and their avatar files. User authentication accounts will REMAIN.")) {
            return;
        }

        setLoading(true);
        setPurgeProgress([]);
        log("Initializing Protocol 66 (TOTAL PURGE)...");

        try {
            // 1. Get all users
            const usersRef = collection(db, "users");
            const snapshot = await getDocs(usersRef);

            const total = snapshot.size;
            let current = 0;

            log(`Targeting ${total} user records...`);

            for (const userDoc of snapshot.docs) {
                const uid = userDoc.id;

                // 2. Delete the avatar objects (B2 bucket + legacy Firebase Storage)
                await deleteAvatarFiles(uid, userDoc.data().photoURL);

                // 3. Delete Firestore Document
                await deleteDoc(doc(db, "users", uid));

                current++;
                if (current % 5 === 0) log(`Processed ${current}/${total} users...`);
            }

            log("-----------------------------------");
            log(`PURGE COMPLETE. ${current} records annihilated.`);
            log("NOTE: Auth accounts must be deleted manually in Console.");
            toast(`Operation Complete. ${current} users wiped.`, "success");

        } catch (error: any) {
            console.error(error);
            log("ERROR: " + error.message);
            toast("Purge failed: " + error.message, "error");
        } finally {
            setLoading(false);
        }
    };

    const handleGarbageCollect = async () => {
        if (confirmText !== "EXECUTE ORDER 99") {
            toast("Please type EXECUTE ORDER 99 to confirm.", "error");
            return;
        }

        setLoading(true);
        setPurgeProgress([]);
        log("Initializing Protocol 99 (GARBAGE COLLECTION)...");

        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("isVerified", "==", false));
            log("Scanning for unverified profiles...");

            const snapshot = await getDocs(q);
            const total = snapshot.size;

            if (total === 0) {
                log("No unverified profiles found. System is clean.");
            } else {
                log(`Found ${total} unverified profiles.`);

                let current = 0;
                for (const userDoc of snapshot.docs) {
                    const uid = userDoc.id;
                    // Delete the profile doc and any avatar object it still owns
                    await deleteAvatarFiles(uid, userDoc.data().photoURL);
                    await deleteDoc(doc(db, "users", uid));
                    current++;
                    log(`[${uid}] Deleted.`);
                }
                log("-----------------------------------");
                log(`CLEANUP COMPLETE. ${current} profiles removed.`);
            }
        } catch (error: any) {
            console.error(error);
            log("ERROR: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSyncPending = async () => {
        if (confirmText !== "EXECUTE PROTOCOL 77") {
            toast("Please type EXECUTE PROTOCOL 77 to confirm.", "error");
            return;
        }

        setLoading(true);
        setPurgeProgress([]);
        log("Initializing Protocol 77 (SYNC PENDING)...");

        try {
            // Rules only allow creating pending_registrations/{uid} for your own
            // uid, so the repair runs through the CTO-gated server route (Admin
            // SDK) instead of writing another admin's request from the client.
            const headers = await getAuthHeaders();
            if (!headers) throw new Error("Not signed in.");

            const res = await fetch("/api/admin/pending-registrations/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...headers },
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(result?.error || `Request failed (${res.status}).`);

            log(`Scanned ${result.scanned} admins with role='pending'.`);
            (result.emails as string[] | undefined)?.forEach(email => log(`Restored request for ${email}.`));
            log("-----------------------------------");
            log(`SYNC COMPLETE. ${result.restored} requests restored.`);
            toast(`Operation Complete. ${result.restored} requests restored.`, "success");

        } catch (error: any) {
            console.error(error);
            log("ERROR: " + error.message);
            toast("Sync failed: " + error.message, "error");
        } finally {
            setLoading(false);
        }
    };

    interface CollectionEntry {
        id: string;
        name: string;
        icon: LucideIcon;
        color: string;
        /** firestore.rules sets `write: if false`: server routes own the data. */
        readOnly?: boolean;
    }

    // Mirrors firestore.rules. Collections whose writes are server-only are
    // marked readOnly so the console never offers an edit the rules reject.
    const collectionGroups: { title: string; items: CollectionEntry[] }[] = [
        {
            title: "User Management",
            items: [
                { id: 'admins', name: 'Admins', icon: ShieldAlert, color: 'text-purple-400' },
                { id: 'users', name: 'Users', icon: Users, color: 'text-blue-400' },
                { id: 'pending_registrations', name: 'Pending Admins', icon: AlertTriangle, color: 'text-orange-500' },
                { id: 'club_roles', name: 'Club Roles', icon: Shield, color: 'text-purple-300' },
            ]
        },
        {
            title: "Content & Team",
            items: [
                { id: 'events', name: 'Events', icon: Calendar, color: 'text-green-400' },
                { id: 'gallery', name: 'Gallery', icon: ImageIcon, color: 'text-pink-400' },
                { id: 'resources', name: 'Resources', icon: BookOpen, color: 'text-teal-400' },
                { id: 'alumni', name: 'Alumni', icon: GraduationCap, color: 'text-amber-400' },
                { id: 'ex_core_members', name: 'Ex-Core', icon: History, color: 'text-fuchsia-400' },
                { id: 'projects', name: 'Projects', icon: FolderKanban, color: 'text-sky-400' },
            ]
        },
        {
            title: "Event Operations",
            items: [
                { id: 'registrations', name: 'Registrations', icon: Folder, color: 'text-orange-400' },
                { id: 'invitations', name: 'Invitations', icon: Folder, color: 'text-blue-300' },
                { id: 'attendance_records', name: 'Attendance', icon: UserCheck, color: 'text-emerald-400', readOnly: true },
                { id: 'attendance_sessions', name: 'Sessions', icon: Clock, color: 'text-cyan-400', readOnly: true },
                { id: 'event_secrets', name: 'Event Secrets', icon: KeyRound, color: 'text-red-300' },
                { id: 'forms', name: 'Forms', icon: ClipboardList, color: 'text-indigo-300', readOnly: true },
                { id: 'form_submissions', name: 'Submissions', icon: FileText, color: 'text-indigo-400', readOnly: true },
            ]
        },
        {
            title: "System Data",
            items: [
                { id: 'feedbacks', name: 'Feedbacks', icon: MessageSquare, color: 'text-yellow-200' },
                { id: 'messages', name: 'Messages', icon: MessageSquare, color: 'text-indigo-400' },
                { id: 'audit_logs', name: 'Audit Logs', icon: Database, color: 'text-red-500' },
                { id: 'settings', name: 'Settings', icon: Settings, color: 'text-gray-400' },
            ]
        }
    ];

    const activeEntry = collectionGroups.flatMap(group => group.items).find(item => item.id === activeCollection);

    return (
        <div className="max-w-7xl mx-auto text-white pb-20">
            <PageHeader
                title="System Console"
                subtitle="Direct database access & storage management."
                icon={<TerminalSquare size={26} />}
                actions={
                    <div className="text-xs font-mono text-gray-500">
                        Logged in as: <span className="text-blue-400">{user?.email}</span>
                    </div>
                }
            />

            {/* Main Console Area */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-20">
                {/* Sidebar / Grid of Collections */}
                <div className="lg:col-span-1 space-y-6">
                    {collectionGroups.map((group) => (
                        <div key={group.title}>
                            <h2 className="text-xs font-bold text-gray-500 uppercase mb-3 px-2 flex items-center gap-2">
                                <span className="w-1 h-1 bg-gray-600 rounded-full"></span> {group.title}
                            </h2>
                            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                                {group.items.map(col => (
                                    <button
                                        key={col.id}
                                        onClick={() => setActiveCollection(col.id)}
                                        className={`w-full text-left p-3 rounded-lg flex items-center gap-3 transition-all ${activeCollection === col.id ? 'bg-blue-600 shadow-lg shadow-blue-900/50 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        <col.icon size={18} className={activeCollection === col.id ? 'text-white' : col.color} />
                                        <span className="font-mono text-sm">{col.name}</span>
                                        {activeCollection === col.id && <ChevronRight size={16} className="ml-auto opacity-50" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Active View */}
                <div className="lg:col-span-3">
                    {activeCollection === 'settings' ? (
                        <SettingsPanel onClose={() => setActiveCollection(null)} />
                    ) : activeCollection ? (
                        <CollectionManager
                            collectionName={activeCollection}
                            onClose={() => setActiveCollection(null)}
                            readOnly={activeEntry?.readOnly ?? false}
                        />
                    ) : (
                        <div className="h-[600px] border border-white/5 border-dashed rounded-2xl flex flex-col items-center justify-center text-gray-600 bg-white/[0.02]">
                            <Database size={64} className="mb-6 opacity-20" />
                            <h3 className="text-xl font-bold mb-2 text-gray-500">No Collection Selected</h3>
                            <p className="text-sm">Select a collection from the sidebar to view and manage data.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Danger Zone */}
            <div className="mt-20 pt-12 border-t border-red-900/30">
                {!showProtocol ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="flex flex-col items-center justify-center text-center p-6 border border-red-500/10 rounded-2xl bg-red-950/5 hover:bg-red-950/10 transition-colors">
                            <AlertTriangle size={32} className="text-red-900 mb-4 opacity-50" />
                            <h2 className="text-xl font-bold text-red-500 mb-1">Protocol 418</h2>
                            <p className="text-gray-500 mb-6 text-xs h-8">
                                Transfer CTO Role to another Admin.
                            </p>
                            <button
                                onClick={() => setShowProtocol("418")}
                                className="bg-red-900/20 border border-red-500/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all"
                            >
                                <Users size={16} /> Transfer Role
                            </button>
                        </div>

                        <div className="flex flex-col items-center justify-center text-center p-6 border border-red-500/10 rounded-2xl bg-red-950/5 hover:bg-red-950/10 transition-colors">
                            <Skull size={32} className="text-red-900 mb-4 opacity-50" />
                            <h2 className="text-xl font-bold text-red-500 mb-1">Protocol 66</h2>
                            <p className="text-gray-500 mb-6 text-xs h-8">
                                Wipe all User Profiles & Avatars.
                            </p>
                            <button
                                onClick={() => setShowProtocol("66")}
                                className="bg-red-900/20 border border-red-500/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all"
                            >
                                <Trash2 size={16} /> Total Purge
                            </button>
                        </div>

                        <div className="flex flex-col items-center justify-center text-center p-6 border border-red-500/10 rounded-2xl bg-red-950/5 hover:bg-red-950/10 transition-colors">
                            <Eraser size={32} className="text-red-900 mb-4 opacity-50" />
                            <h2 className="text-xl font-bold text-red-500 mb-1">Protocol 99</h2>
                            <p className="text-gray-500 mb-6 text-xs h-8">
                                Delete Unverified Users Only.
                            </p>
                            <button
                                onClick={() => setShowProtocol("99")}
                                className="bg-red-900/20 border border-red-500/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all"
                            >
                                <Eraser size={16} /> Garbage Collect
                            </button>
                        </div>

                        <div className="flex flex-col items-center justify-center text-center p-6 border border-red-500/10 rounded-2xl bg-red-950/5 hover:bg-red-950/10 transition-colors">
                            <RefreshCw size={32} className="text-red-900 mb-4 opacity-50" />
                            <h2 className="text-xl font-bold text-red-500 mb-1">Protocol 77</h2>
                            <p className="text-gray-500 mb-6 text-xs h-8">
                                Sync Admin Requests.
                            </p>
                            <button
                                onClick={() => setShowProtocol("77")}
                                className="bg-red-900/20 border border-red-500/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all"
                            >
                                <RefreshCw size={16} /> Sync Requests
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="max-w-2xl mx-auto animate-in slide-in-from-bottom-10 fade-in duration-500">
                        {showProtocol === "418" && (
                            <div className="bg-red-950/30 border border-red-500/30 rounded-2xl p-8 backdrop-blur-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                                    <AlertTriangle size={200} />
                                </div>

                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-2xl font-bold text-red-500 flex items-center gap-2">Protocol 418: Role Transfer</h2>
                                    <button onClick={() => setShowProtocol(null)}><X className="text-gray-500 hover:text-white" /></button>
                                </div>

                                <p className="text-gray-400 mb-8 font-mono border-l-2 border-red-500 pl-4">
                                    <strong>System Notice:</strong> You are initializing the Transfer of Power protocol.
                                    Upon successful execution, your administrative tokens will be immediately partially revoked.
                                </p>

                                <form onSubmit={handleTransfer} className="space-y-6 relative z-10">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-400 mb-2">Successor Email</label>
                                        <input
                                            type="email"
                                            required
                                            placeholder="successor@relu.club"
                                            className="w-full bg-black/60 border border-white/10 rounded-lg p-3 focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-mono"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-400 mb-2">Confirmation</label>
                                        <input
                                            type="text"
                                            required
                                            placeholder="Type 'TRANSFER ROLE' to confirm"
                                            className="w-full bg-black/60 border border-white/10 rounded-lg p-3 focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-mono"
                                            value={confirmText}
                                            onChange={e => setConfirmText(e.target.value)}
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={loading || confirmText !== "TRANSFER ROLE"}
                                        className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        {loading ? "Executing..." : "EXECUTE TRANSFER"}
                                    </button>
                                </form>
                            </div>
                        )}

                        {(showProtocol === "66" || showProtocol === "99" || showProtocol === "77") && (
                            <div className="bg-red-950/30 border border-red-500/30 rounded-2xl p-8 backdrop-blur-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                                    {showProtocol === "66" ? <Skull size={200} /> : <Eraser size={200} />}
                                </div>

                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-2xl font-bold text-red-500 flex items-center gap-2">
                                        Protocol {showProtocol}: {showProtocol === "66" ? "Data Purge" : showProtocol === "99" ? "Garbage Collection" : "Sync Pending Requests"}
                                    </h2>
                                    <button onClick={() => setShowProtocol(null)}><X className="text-gray-500 hover:text-white" /></button>
                                </div>

                                <div className="bg-black/40 p-4 rounded-lg border border-red-500/20 mb-6 font-mono text-xs text-red-300 max-h-40 overflow-y-auto">
                                    {purgeProgress.length > 0 ? (
                                        purgeProgress.map((log, i) => <div key={i}>{log}</div>)
                                    ) : (
                                        <div className="opacity-50">Waiting for command inputs...</div>
                                    )}
                                </div>

                                <p className="text-gray-400 mb-6 font-mono border-l-2 border-red-500 pl-4 text-sm">
                                    <strong>WARNING:</strong> This action {showProtocol === "66" ? "deletes ALL user documents" : showProtocol === "99" ? "deletes unverified user documents" : "creates missing pending registration records"}.
                                    <br /><br />
                                    <span className="text-red-400">NOTE:</span> Firebase Authentication Accounts CANNOT be deleted via this console and must be removed manually.
                                </p>

                                <div className="space-y-6 relative z-10">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-400 mb-2">Confirmation</label>
                                        <input
                                            type="text"
                                            required
                                            placeholder={`Type '${showProtocol === "77" ? "EXECUTE PROTOCOL 77" : `EXECUTE ORDER ${showProtocol}`}' to confirm`}
                                            className="w-full bg-black/60 border border-white/10 rounded-lg p-3 focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-mono"
                                            value={confirmText}
                                            onChange={e => setConfirmText(e.target.value)}
                                        />
                                    </div>

                                    <button
                                        onClick={showProtocol === "66" ? handlePurgeUsers : showProtocol === "99" ? handleGarbageCollect : handleSyncPending}
                                        disabled={loading || confirmText !== `EXECUTE ORDER ${showProtocol}` && confirmText !== `EXECUTE PROTOCOL ${showProtocol}`}
                                        className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        {loading ? "EXECUTING..." : "EXECUTE"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div >
    );
}
