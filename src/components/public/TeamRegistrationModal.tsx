"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    X, Plus, Search, Loader2, AlertCircle, Send, Check, Clock,
    UserPlus, Users, ArrowLeft, User, Trash2, LogOut
} from "lucide-react";
import { Event, UserProfile, TeamInvitation, EventRegistration, AvailableTeam, StudentSearchResult } from "@/types";
import {
    searchStudents, sendInvitation, subscribeToTeamInvitations,
    getAvailableTeams, requestToJoinTeam, deleteTeam, removeTeamMember
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface TeamRegistrationModalProps {
    event: Event;
    userProfile: UserProfile;
    existingRegistration?: EventRegistration | null;
    onClose: () => void;
    onRegister: (teamName: string) => Promise<void>;
    onStatusChange?: () => void;
}

export default function TeamRegistrationModal({ event, userProfile, existingRegistration, onClose, onRegister, onStatusChange }: TeamRegistrationModalProps) {
    const minSize = event.minTeamSize || 1;
    const maxSize = event.maxTeamSize || 1;

    // Determine Leader Status
    const isLeader = !existingRegistration || existingRegistration.userId === userProfile.uid;

    // View state: 'select' (choose path) | 'create' (form) | 'join' (list)
    // If existing registration, default to 'create' (which shows invite screen if created)
    const [view, setView] = useState<'select' | 'create' | 'join'>(
        existingRegistration ? 'create' : 'select'
    );

    // Create Team State
    const [teamName, setTeamName] = useState(existingRegistration?.teamName || "");
    const [teamCreated, setTeamCreated] = useState(!!existingRegistration);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const closeRef = useRef<HTMLButtonElement>(null);
    const toast = useToast();

    // Dialog semantics: Escape (when not mutating) and backdrop close,
    // initial focus on the close button so keyboard users start oriented.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !loading) onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        closeRef.current?.focus();
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose, loading]);

    // Search/Invite State (for Create flow)
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState<StudentSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [sentInvitations, setSentInvitations] = useState<TeamInvitation[]>([]);
    const [sendingTo, setSendingTo] = useState<string | null>(null);

    // Join Team State
    const [availableTeams, setAvailableTeams] = useState<AvailableTeam[]>([]);
    const [loadingTeams, setLoadingTeams] = useState(false);
    const [requestingTo, setRequestingTo] = useState<string | null>(null);

    // Handlers for Delete/Remove/Leave
    const handleDeleteTeam = async () => {
        if (!confirm("Are you sure? This will disband the team and cancel all invitations. This action cannot be undone.")) return;
        setLoading(true);
        try {
            await deleteTeam(event.id);
            onStatusChange?.();
            onClose();
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to delete team.");
            setLoading(false);
        }
    };

    const handleRemoveMember = async (targetUserId: string) => {
        if (!confirm("Remove this member from the team?")) return;
        try {
            await removeTeamMember(event.id, userProfile.uid, targetUserId);
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Failed to remove member.");
        }
    };

    const handleLeaveTeam = async () => {
        if (!confirm("Are you sure you want to leave this team?")) return;
        setLoading(true);
        try {
            const leaderId = existingRegistration?.userId;
            if (!leaderId) throw new Error("Leader not found");
            await removeTeamMember(event.id, leaderId, userProfile.uid);
            onStatusChange?.();
            onClose();
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to leave team.");
            setLoading(false);
        }
    };

    // --- Create Flow Logic ---

    // Debounced search for students
    useEffect(() => {
        if (!teamCreated || searchTerm.length < 2) {
            setSearchResults([]);
            return;
        }

        let active = true;

        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const results = await searchStudents(searchTerm);
                if (!active) return;

                // Filter out: self and ALREADY ACCEPTED members (who are now part of the team)
                const teamMemberIds = new Set(sentInvitations
                    .filter(i => i.status === 'accepted')
                    .map(i => i.type === 'request' ? i.senderId : i.targetUserId)
                );

                const filtered = results.filter(u =>
                    u.uid !== userProfile.uid && !teamMemberIds.has(u.uid)
                );

                if (active) {
                    setSearchResults(filtered);
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (active) {
                    setSearching(false);
                }
            }
        }, 400);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [searchTerm, teamCreated, userProfile.uid, sentInvitations]);

    // Subscribe to invitation statuses
    useEffect(() => {
        if (!teamCreated || !isLeader) return; // Only leader subscribesinvitations
        const unsub = subscribeToTeamInvitations(event.id, userProfile.uid, (invs) => {
            setSentInvitations(invs);
        });
        return () => unsub();
    }, [teamCreated, isLeader, event.id, userProfile.uid]);

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!teamName.trim()) {
            setError("Team name is required.");
            return;
        }

        setLoading(true);
        try {
            await onRegister(teamName);
            setTeamCreated(true);
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to create team.");
        } finally {
            setLoading(false);
        }
    };

    const handleInvite = async (student: StudentSearchResult) => {
        setSendingTo(student.uid);
        setError("");
        try {
            await sendInvitation(event.id, student.uid);
            setSearchTerm("");
            setSearchResults([]);
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to send invitation.");
        } finally {
            setSendingTo(null);
        }
    };

    // --- Join Flow Logic ---

    const loadAvailableTeams = useCallback(async () => {
        setLoadingTeams(true);
        try {
            const teams = await getAvailableTeams(event.id);
            setAvailableTeams(teams);
        } catch (e) {
            console.error("Failed to load teams", e);
        } finally {
            setLoadingTeams(false);
        }
    }, [event.id]);

    useEffect(() => {
        if (view === 'join') {
            loadAvailableTeams();
        }
    }, [view, loadAvailableTeams]);

    const handleRequestJoin = async (team: AvailableTeam) => {
        setRequestingTo(team.id);
        setError("");
        try {
            await requestToJoinTeam(event.id, team.id);
            await loadAvailableTeams();
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to send join request.");
        } finally {
            setRequestingTo(null);
        }
    };


    // --- Render Helpers ---

    // Calculate Counts & Members
    const currentMemberCount = isLeader
        ? 1 + sentInvitations.filter(i => i.status === 'accepted').length
        : 1 + (existingRegistration?.teamMembers?.length || 0);

    const pendingCount = isLeader
        ? sentInvitations.filter(i => i.status === 'pending').length
        : 0;

    const canInviteMore = currentMemberCount < maxSize;

    // Prepare list of members to display
    const leaderInfo = isLeader
        ? { name: userProfile.displayName, rollNo: userProfile.rollNo, initial: userProfile.displayName?.charAt(0) || "?" }
        : {
            name: existingRegistration?.userDetails.name || "Unknown",
            rollNo: existingRegistration?.userDetails.rollNo || "Unknown",
            initial: existingRegistration?.userDetails.name?.charAt(0) || "?"
        };

    const membersList = isLeader
        ? sentInvitations.map(inv => ({
            id: inv.id,
            userId: inv.type === 'request' ? inv.senderId : inv.targetUserId,
            name: inv.type === 'request' ? inv.senderName : inv.targetName,
            rollNo: inv.type === 'request' ? 'Unknown' : inv.targetRollNo,
            initial: (inv.type === 'request' ? inv.senderName : inv.targetName).charAt(0),
            status: inv.status,
            type: inv.type
        }))
        : (existingRegistration?.teamMembers || []).map((m: any, idx: number) => ({
            id: `mem-${idx}`,
            userId: m.userId,
            name: m.name,
            rollNo: m.rollNo,
            initial: m.name?.charAt(0) || "?",
            status: 'accepted' as const,
            type: 'invite' as const
        }));


    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Team registration"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
        >
            <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative shadow-2xl">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center sticky top-0 bg-[#111] z-10">
                    <div className="flex items-center gap-3">
                        {view !== 'select' && !teamCreated && (
                            <button onClick={() => setView('select')} className="p-1 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors">
                                <ArrowLeft size={20} />
                            </button>
                        )}
                        <div>
                            <h2 className="text-2xl font-bold text-white">
                                {view === 'select' ? "Team Registration" :
                                    view === 'join' ? "Join a Team" :
                                        teamCreated ? (isLeader ? "Manage Team" : "Team Details") : "Create Team"}
                            </h2>
                            <p className="text-gray-400 text-sm mt-1">
                                {event.title} • Size: {minSize} - {maxSize} Members
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} ref={closeRef} aria-label="Close team registration" className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* VIEW 1: Selection */}
                {view === 'select' && (
                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <button
                            onClick={() => setView('create')}
                            className="flex flex-col items-center justify-center gap-4 p-8 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all group"
                        >
                            <div className="w-16 h-16 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Plus size={32} />
                            </div>
                            <div className="text-center">
                                <h3 className="text-xl font-bold text-white mb-2">Create a Team</h3>
                                <p className="text-gray-400 text-sm">Start a new team as a leader and invite your friends.</p>
                            </div>
                        </button>

                        <button
                            onClick={() => setView('join')}
                            className="flex flex-col items-center justify-center gap-4 p-8 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 transition-all group"
                        >
                            <div className="w-16 h-16 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Users size={32} />
                            </div>
                            <div className="text-center">
                                <h3 className="text-xl font-bold text-white mb-2">Join a Team</h3>
                                <p className="text-gray-400 text-sm">Browse existing teams and request to join them.</p>
                            </div>
                        </button>
                    </div>
                )}

                {/* VIEW 2: Create Team (Inputs) */}
                {view === 'create' && !teamCreated && (
                    <form onSubmit={handleCreateTeam} className="p-6 space-y-6">
                        <div>
                            <label className="block text-sm font-bold text-gray-400 mb-2">Team Name <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={teamName}
                                onChange={(e) => setTeamName(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="e.g. Code Ninjas"
                                autoFocus
                            />
                        </div>

                        {/* Leader Info */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm">
                                    {leaderInfo.initial}
                                </div>
                                <div>
                                    <p className="text-white font-medium">{leaderInfo.name}</p>
                                    <p className="text-xs text-gray-500">{leaderInfo.rollNo} • Team Leader</p>
                                </div>
                                <span className="ml-auto px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-bold uppercase rounded">Leader</span>
                            </div>
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
                            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {loading ? <Loader2 className="animate-spin" size={18} /> : "Create Team & Invite Members"}
                            </button>
                        </div>
                    </form>
                )}

                {/* VIEW 3: Join Team (List) */}
                {view === 'join' && (
                    <div className="p-6">
                        {loadingTeams ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="animate-spin text-blue-500" size={32} />
                            </div>
                        ) : availableTeams.length === 0 ? (
                            <div className="text-center py-12">
                                <Users className="mx-auto text-gray-600 mb-4" size={48} />
                                <h3 className="text-lg font-bold text-white mb-2">No available teams found</h3>
                                <p className="text-gray-400 text-sm max-w-sm mx-auto mb-6">
                                    All teams might be full, or you might have already requested to join them.
                                </p>
                                <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl text-left max-w-md mx-auto">
                                    <p className="text-blue-300 text-sm flex gap-2">
                                        <Loader2 size={16} className="shrink-0 mt-0.5" />
                                        <span>
                                            Unable to see your friend&apos;s team to join? Ask him/her to check his notifications for pending requests or invitations.
                                        </span>
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-gray-400 text-sm">Found {availableTeams.length} available teams:</p>
                                {availableTeams.map((team) => (
                                    <div key={team.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between hover:bg-white/[0.07] transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white font-bold text-sm">
                                                {team.teamName?.charAt(0)}
                                            </div>
                                            <div>
                                                <h4 className="text-white font-bold">{team.teamName}</h4>
                                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                                    <span className="flex items-center gap-1">
                                                        <User size={12} /> {team.leaderName} (Leader)
                                                    </span>
                                                    <span>•</span>
                                                    <span>{team.memberCount}/{maxSize} Members</span>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRequestJoin(team)}
                                            disabled={requestingTo === team.id}
                                            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-lg transition-all"
                                        >
                                            {requestingTo === team.id ? <Loader2 size={16} className="animate-spin" /> : "Request to Join"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Error for join requests */}
                        {error && (
                            <div className="mt-4 bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}
                    </div>
                )}


                {/* VIEW 4: Manage Team (Invite Members) - Active when teamCreated is true */}
                {view === 'create' && teamCreated && (
                    <div className="p-6 space-y-6">
                        {/* Team Status */}
                        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/20 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <p className="text-white font-bold text-lg">{teamName}</p>
                                    <p className="text-gray-400 text-xs mt-0.5">
                                        {currentMemberCount >= minSize
                                            ? "Team meets the minimum size"
                                            : `Need ${minSize - currentMemberCount} more member${minSize - currentMemberCount > 1 ? 's' : ''} to complete`
                                        }
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-2xl font-bold text-white">{currentMemberCount}<span className="text-gray-500 text-sm">/{maxSize}</span></p>
                                    <p className="text-xs text-gray-500">members</p>
                                </div>
                            </div>
                            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                                    style={{ width: `${(currentMemberCount / maxSize) * 100}%` }}
                                />
                            </div>
                        </div>

                        {/* Current Team Members */}
                        <div>
                            <h3 className="text-sm font-bold text-gray-400 mb-3">Team Members</h3>
                            <div className="space-y-2">
                                {/* Leader */}
                                <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-3">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs font-bold">
                                        {leaderInfo.initial}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-white text-sm font-medium">{leaderInfo.name}</p>
                                        <p className="text-gray-500 text-xs">{leaderInfo.rollNo} • Team Leader</p>
                                    </div>
                                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-bold uppercase rounded">Leader</span>
                                </div>

                                {/* Members */}
                                {membersList.map((inv) => (
                                    <div key={inv.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${inv.status === 'accepted' ? 'bg-gradient-to-br from-blue-500 to-purple-600' : 'bg-white/10'}`}>
                                            {inv.initial}
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-white text-sm font-medium">{inv.name}</p>
                                            <p className="text-gray-500 text-xs">{inv.rollNo}</p>
                                        </div>
                                        {inv.type === 'request' ? (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-purple-400 font-bold">Request</span>
                                                {inv.status === 'pending' && <span className="text-xs text-gray-500">Pending Notification</span>}
                                            </div>
                                        ) : (
                                            inv.status === 'pending' && (
                                                <span className="flex items-center gap-1.5 px-2 py-0.5 bg-yellow-500/10 text-yellow-400 text-[10px] font-bold uppercase rounded border border-yellow-500/20">
                                                    <Clock size={10} /> Pending
                                                </span>
                                            )
                                        )}
                                        {inv.status === 'accepted' && (
                                            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-green-500/10 text-green-400 text-[10px] font-bold uppercase rounded border border-green-500/20">
                                                <Check size={10} /> Joined
                                            </span>
                                        )}
                                        {isLeader && (
                                            <button
                                                onClick={() => handleRemoveMember(inv.userId)}
                                                className="ml-2 text-gray-400 hover:text-red-400 p-1.5 hover:bg-white/5 rounded-lg transition-colors"
                                                title="Remove Member"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Search & Invite Section (LEADER ONLY) */}
                        {isLeader && canInviteMore && (
                            <div>
                                <h3 className="text-sm font-bold text-gray-400 mb-3 flex items-center gap-2">
                                    <UserPlus size={14} /> Invite Members
                                </h3>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder="Search by name or roll number..."
                                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-white text-sm focus:border-blue-500 outline-none transition-colors"
                                    />
                                    {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" size={16} />}
                                </div>
                                {searchResults.length > 0 && (
                                    <div className="mt-2 bg-white/5 border border-white/10 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                                        {searchResults.map((student) => {
                                            const existingInvite = sentInvitations.find(i =>
                                                (i.type === 'invite' && i.targetUserId === student.uid && i.status === 'pending') ||
                                                (i.type === 'request' && i.senderId === student.uid && i.status === 'pending')
                                            );
                                            const isSent = existingInvite?.type === 'invite';

                                            return (
                                                <div key={student.uid} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors">
                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                                                        {student.displayName?.charAt(0) || "?"}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-white text-sm font-medium truncate">{student.displayName || "Unknown"}</p>
                                                        <p className="text-gray-500 text-xs">{student.rollNo || "No roll number"}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleInvite(student)}
                                                        disabled={!!existingInvite || sendingTo === student.uid || !student.rollNo}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 shrink-0 ${existingInvite
                                                            ? 'bg-white/10 text-gray-400 cursor-not-allowed'
                                                            : 'bg-blue-600 hover:bg-blue-500 text-white'
                                                            }`}
                                                    >
                                                        {sendingTo === student.uid ? (
                                                            <Loader2 size={12} className="animate-spin" />
                                                        ) : existingInvite ? (
                                                            isSent ? "Sent" : "Req Pending"
                                                        ) : (
                                                            <>
                                                                <Send size={12} /> Invite
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {searchTerm.length >= 2 && !searching && searchResults.length === 0 && (
                                    <p className="mt-2 text-gray-500 text-sm text-center py-4">No students found matching &quot;{searchTerm}&quot;</p>
                                )}
                            </div>
                        )}

                        <div className="pt-4 border-t border-white/10 flex justify-between items-center">
                            <div className="flex flex-col items-start gap-1">
                                <p className="text-gray-500 text-xs">
                                    {currentMemberCount >= minSize ? "Your team is ready!" : `Waiting for ${minSize - currentMemberCount} more members`}
                                </p>
                                {isLeader ? (
                                    <button onClick={handleDeleteTeam} className="flex items-center gap-1.5 text-red-500 hover:text-red-400 text-xs font-bold transition-colors">
                                        <Trash2 size={12} /> Delete Team
                                    </button>
                                ) : (
                                    <button onClick={handleLeaveTeam} className="flex items-center gap-1.5 text-red-500 hover:text-red-400 text-xs font-bold transition-colors">
                                        <LogOut size={12} /> Leave Team
                                    </button>
                                )}
                            </div>
                            <button onClick={onClose} className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg transition-all">
                                Done
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
