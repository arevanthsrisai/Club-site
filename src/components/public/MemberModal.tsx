"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AdminProfile } from "@/types";
import { ClubRole, roleLabel } from "@/lib/roles";
import { formatDisplayDate } from "@/lib/birthdays";
import { safeHttpUrl } from "@/lib/publicUrl";
import { Shield, Briefcase, GraduationCap, Coins, Terminal, Zap, Crown, Linkedin, Github, Instagram, X, Calendar, User, History } from "lucide-react";
import Image from "next/image";

// Re-exported for the components that imported it from this module before it
// moved to /lib/publicUrl (which the server API routes also use).
export { safeHttpUrl };

export function RoleIcon({ role, className = "" }: { role: string; className?: string }) {
    const icon = {
        "President": <Crown className="text-yellow-500" size={16} />,
        "VP_AIML": <Shield className="text-blue-500" size={16} />,
        "VP_DSA": <Shield className="text-blue-500" size={16} />,
        "Mentor": <GraduationCap className="text-purple-500" size={16} />,
        "Treasurer": <Coins className="text-green-500" size={16} />,
        "CTO": <Terminal className="text-red-500" size={16} />,
        "Activator": <Zap className="text-orange-500" size={16} />,
    }[role] ?? <Briefcase className="text-gray-400" size={16} />;
    return <span className={className} aria-hidden="true">{icon}</span>;
}

interface MemberModalProps {
    member: AdminProfile;
    roles: ClubRole[];
    onClose: () => void;
    /** Public renders hide internal-only fields (status, join date, role icons). */
    publicView?: boolean;
    /** When present the modal shows Ex-Core data: bio + role-history
     *  tenures (newest first) — and hides the internal admin-profile fields.
     *  Each tenure label spans its recorded years, e.g. “2026–28” for a
     *  two-year tenure covering 2026–27 and 2027–28. */
    exCore?: {
        bio?: string;
        memberType: "core" | "activator";
        tenures: { label: string; role: string }[];
    } | null;
}

/**
 * Member detail dialog — the single source of truth for the team card
 * interaction, used by /admin/team AND every public team category on /about
 * (Core Team, Activators, and any other card the site shows). Must stay one
 * design; do not fork it per-page.
 */
export default function MemberModal({ member, roles, onClose, publicView = false, exCore = null }: MemberModalProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    // Focus is moved into the dialog on open and returned to the opener on close.
    const restoreRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        restoreRef.current = document.activeElement as HTMLElement | null;
        closeButtonRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            restoreRef.current?.focus?.();
        };
    }, [onClose]);

    const socials: Array<{ label: string; href: string; icon: ReactNode; cls: string }> = [];
    const li = safeHttpUrl(member.socials?.linkedin);
    if (li) socials.push({ label: "LinkedIn", href: li, icon: <Linkedin size={16} />, cls: "bg-[#0077b5]/20 text-[#0077b5] hover:bg-[#0077b5]/30" });
    const gh = safeHttpUrl(member.socials?.github);
    if (gh) socials.push({ label: "GitHub", href: gh, icon: <Github size={16} />, cls: "bg-white/10 text-white hover:bg-white/20" });
    const ig = safeHttpUrl(member.socials?.instagram);
    if (ig) socials.push({ label: "Instagram", href: ig, icon: <Instagram size={16} />, cls: "bg-pink-500/20 text-pink-500 hover:bg-pink-500/30" });

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
            role="presentation"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="member-modal-name"
                className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative"
                onClick={e => e.stopPropagation()}
            >
                <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={onClose}
                    aria-label={`Close details for ${member.displayName || member.email}`}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white bg-black/50 p-2 rounded-full transition-colors z-10 focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                    <X size={18} aria-hidden="true" />
                </button>

                <div className="grid md:grid-cols-[250px_1fr]">
                    {/* Sidebar / Photo */}
                    <div className="bg-gradient-to-b from-[#000080]/20 to-black p-8 flex flex-col items-center justify-center text-center border-b md:border-b-0 md:border-r border-white/10">
                        <div className="w-36 h-36 md:w-40 md:h-40 rounded-full p-1 bg-[#000080] mb-6 shadow-[0_0_30px_rgba(0,0,128,0.4)] relative">
                            <div className="w-full h-full rounded-full overflow-hidden bg-black relative">
                                {member.photoURL ? (
                                    <Image src={member.photoURL} alt="" fill className="object-cover" sizes="160px" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold text-4xl" aria-hidden="true">
                                        {(member.displayName || member.email)[0].toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <div className="absolute -bottom-2 -right-2 bg-[#111] rounded-full p-2 border border-white/10 shadow-lg">
                                <RoleIcon role={member.role} />
                            </div>
                        </div>
                        <h2 id="member-modal-name" className="text-2xl font-bold text-white mb-1 break-words">{member.displayName || member.email}</h2>
                        <span className="text-blue-400 text-sm font-mono uppercase tracking-wider bg-blue-500/10 px-3 py-1 rounded-full break-words max-w-full text-center">
                            {exCore
                                ? (exCore.memberType === "activator" ? "Activator" : "Ex-Core")
                                : roleLabel(roles, member.role)}
                        </span>
                    </div>

                    {/* Ex-Core view: bio + role-history tenures, newest first. */}
                    {exCore ? (
                        <div className="p-6 md:p-8 space-y-6">
                            {exCore.bio && (
                                <div>
                                    <h3 className="text-lg font-bold text-gray-400 mb-3 flex items-center gap-2">
                                        <User size={18} aria-hidden="true" /> About
                                    </h3>
                                    <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">{exCore.bio}</p>
                                </div>
                            )}
                            <div>
                                <h3 className="text-lg font-bold text-gray-400 mb-3 flex items-center gap-2">
                                    <History size={18} aria-hidden="true" /> Role history
                                </h3>
                                {exCore.tenures.length === 0 ? (
                                    <p className="text-gray-600 text-sm italic">No role history recorded.</p>
                                ) : (
                                    <ul className="space-y-2">
                                        {exCore.tenures.map((e, i) => (
                                            <li key={i} className="text-sm text-gray-200 flex items-baseline gap-3">
                                                <span className="text-gray-500 font-mono shrink-0">{e.label}</span>
                                                <span className="break-words">{e.role}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-400 mb-3 flex items-center gap-2">
                                    <Shield size={18} aria-hidden="true" /> Connect
                                </h3>
                                <div className="flex gap-3 flex-wrap">
                                    {socials.length === 0 && (
                                        <span className="text-gray-600 text-sm italic">No public profiles linked.</span>
                                    )}
                                    {socials.map(s => (
                                        <a
                                            key={s.label}
                                            href={s.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium text-sm focus-visible:ring-2 focus-visible:ring-blue-400 ${s.cls}`}
                                        >
                                            {s.icon} {s.label}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                    <div className="p-6 md:p-8 space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-gray-400 mb-3 flex items-center gap-2">
                                <User size={18} aria-hidden="true" /> About
                            </h3>
                            <div className="space-y-3">
                                <div className="grid grid-cols-[100px_1fr] gap-2 text-sm max-sm:grid-cols-1">
                                    <span className="text-gray-500">Email:</span>
                                    <span className="text-white break-all">{member.email}</span>
                                </div>
                                {member.rollNo && (
                                    <div className="grid grid-cols-[100px_1fr] gap-2 text-sm max-sm:grid-cols-1">
                                        <span className="text-gray-500">Roll No:</span>
                                        <span className="text-white font-mono break-all">{member.rollNo}</span>
                                    </div>
                                )}
                                {member.dob && !publicView && (
                                    <div className="grid grid-cols-[100px_1fr] gap-2 text-sm max-sm:grid-cols-1">
                                        <span className="text-gray-500">Birthday:</span>
                                        {/* DOBs are stored as "YYYY-MM-DD" strings; parsing them
                                            as UTC Dates shifts the shown day in negative-offset
                                            time zones. formatDisplayDate never constructs a UTC
                                            date, so it renders the stored day identically. */}
                                        <span className="text-white">{formatDisplayDate(member.dob)}</span>
                                    </div>
                                )}
                                {!publicView && (
                                    <div className="grid grid-cols-[100px_1fr] gap-2 text-sm max-sm:grid-cols-1">
                                        <span className="text-gray-500">Status:</span>
                                        <span className={`capitalize ${member.status === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>{member.status}</span>
                                    </div>
                                )}
                                {!publicView && (
                                    <div className="grid grid-cols-[100px_1fr] gap-2 text-sm max-sm:grid-cols-1">
                                        <span className="text-gray-500">Joined:</span>
                                        <span className="text-gray-300">
                                            {member.createdAt?.toDate ? member.createdAt.toDate().toLocaleDateString() : 'N/A'}
                                        </span>
                                    </div>
                                )}
                                {publicView && member.socials && Object.keys(member.socials).length === 0 && !member.dob && !member.rollNo && (
                                    <p className="text-gray-600 text-sm italic">This member has filled in their socials — opening a card shows contact links when present.</p>
                                )}
                            </div>
                        </div>

                        {/* Socials */}
                        <div>
                            <h3 className="text-lg font-bold text-gray-400 mb-3 flex items-center gap-2">
                                <Shield size={18} aria-hidden="true" /> {publicView ? "Connect" : "Socials"}
                            </h3>
                            <div className="flex gap-3 flex-wrap">
                                {socials.length === 0 && (
                                    <span className="text-gray-600 text-sm italic">{publicView ? "No public profiles linked." : "No social profiles linked."}</span>
                                )}
                                {socials.map(s => (
                                    <a
                                        key={s.label}
                                        href={s.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium text-sm focus-visible:ring-2 focus-visible:ring-blue-400 ${s.cls}`}
                                    >
                                        {s.icon} {s.label}
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
}
