"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, Check, X, Loader2, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { subscribeToMyInvitations, respondToInvitation } from "@/lib/api";
import { TeamInvitation } from "@/types";
import { useToast } from "@/components/ui/Toast";

export default function NotificationBell() {
    const { user, profile } = useAuth();
    const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
    const [open, setOpen] = useState(false);
    const [responding, setResponding] = useState<string | null>(null);
    const toast = useToast();
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Only show for public users (not admins)
    useEffect(() => {
        if (!user || profile) return;

        const unsub = subscribeToMyInvitations(user.uid, (data) => {
            setInvitations(data);
        });

        return () => unsub();
    }, [user, profile]);

    // Close dropdown on outside click or Escape
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    const handleRespond = async (invitationId: string, response: 'accepted' | 'rejected') => {
        setResponding(invitationId);
        try {
            await respondToInvitation(invitationId, response);
            // Real-time subscription will auto-remove it from the list
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Failed to respond.");
        } finally {
            setResponding(null);
        }
    };

    // Don't render anything if not a public user
    if (!user || profile) return null;

    return (
        <div ref={dropdownRef} className="relative">
            {/* Bell Button */}
            <button
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label={`Notifications${invitations.length ? ` (${invitations.length} pending)` : ""}`}
                className="relative p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
            >
                <Bell size={20} />
                {invitations.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse shadow-lg shadow-red-500/50">
                        {invitations.length}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {open && (
                <div className="absolute top-[calc(100%+12px)] right-0 w-80 md:w-96 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[100] animate-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                        <h3 className="font-bold text-white text-sm">Team Invitations</h3>
                        {invitations.length > 0 && (
                            <span className="text-xs text-gray-500">{invitations.length} pending</span>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                        {invitations.length === 0 ? (
                            <div className="p-8 text-center text-gray-500">
                                <Bell size={24} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No pending invitations</p>
                            </div>
                        ) : (
                            invitations.map((inv) => (
                                <div key={inv.id} className="px-4 py-4 border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                                            <Users size={18} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-white text-sm font-medium">
                                                <span className="text-blue-400">{inv.senderName}</span> invited you to join team
                                            </p>
                                            <p className="text-white font-bold text-sm mt-0.5">&quot;{inv.teamName}&quot;</p>
                                            <p className="text-gray-500 text-xs mt-1">
                                                Event: {inv.eventTitle}
                                            </p>

                                            {/* Action Buttons */}
                                            <div className="flex gap-2 mt-3">
                                                <button
                                                    onClick={() => handleRespond(inv.id, 'accepted')}
                                                    disabled={responding === inv.id}
                                                    className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    {responding === inv.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                    Accept
                                                </button>
                                                <button
                                                    onClick={() => handleRespond(inv.id, 'rejected')}
                                                    disabled={responding === inv.id}
                                                    className="flex items-center gap-1.5 px-4 py-1.5 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 text-xs font-bold rounded-lg border border-white/10 transition-colors disabled:opacity-50"
                                                >
                                                    <X size={12} />
                                                    Decline
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
