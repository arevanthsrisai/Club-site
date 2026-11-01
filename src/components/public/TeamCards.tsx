"use client";

import Image from "next/image";
import { User, ChevronRight } from "lucide-react";

/**
 * Shared team-card visual — the SAME design every public team category uses
 * (the /about Core Team card). Decoupled from member types so /ex-core can
 * render identical cards for former Core members and Activators, and /about
 * keeps its exact current look by using this component instead of a local copy.
 */

export interface TeamCardStats {
    name: string;
    role: string; // label text under the name
    image: string; // empty string triggers the initials fallback
}


export default function TeamMemberCard({
    member,
    onOpen,
    accentScope,
    icon,
}: {
    member: TeamCardStats;
    onOpen: () => void;
    /** Force one accent ("blue" | "purple" | "yellow") instead of name-parity hashing. */
    accentScope?: "blue" | "purple" | "yellow";
    /** Optional role badge icon (rendered from the member's category/role). */
    icon?: React.ReactNode;
}) {
    const initials = member.name.charAt(0).toUpperCase();
    const accent = accentScope ?? (member.name.length % 2 === 0 ? "blue" : "purple");

    const halo =
        accent === "yellow"
            ? "bg-gradient-to-r from-yellow-400 to-yellow-600"
            : accent === "purple"
                ? "bg-gradient-to-r from-purple-500 to-pink-500"
                : "bg-gradient-to-r from-blue-500 to-cyan-400";

    const ring = accent === "yellow" ? "border-yellow-500/30" : "border-blue-500/30";

    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label={`View contact details for ${member.name}`}
            className="group relative w-full max-w-sm text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-2xl"
        >
            <div
                className={`absolute -inset-0.5 rounded-2xl opacity-40 group-hover:opacity-90 blur-md transition duration-300 ${halo}`}
                aria-hidden="true"
            />
            <div className="relative bg-black/80 backdrop-blur-xl rounded-2xl p-6 border border-blue-500/30 flex flex-col items-center transition-transform duration-300 group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0">
                <div className="relative w-24 h-24 mb-4">
                    <div className={`w-full h-full rounded-full border-2 ${ring} overflow-hidden shadow-[0_0_15px_rgba(59,130,246,0.3)] bg-black relative`}>
                        {member.image ? (
                            <Image src={member.image} alt="" fill className="object-cover" sizes="96px" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500/30 to-purple-600/30 text-3xl font-bold text-white/90" aria-hidden="true">
                                {initials}
                            </div>
                        )}
                    </div>
                    {icon && (
                        <div className="absolute -bottom-1 -right-1 bg-[#111] rounded-full p-1.5 border border-white/10 shadow z-10">
                            {icon}
                        </div>
                    )}
                </div>
                <h3 className="text-lg font-bold text-white mb-1 break-words group-hover:text-blue-300 transition-colors">{member.name}</h3>
                <p className="text-xs text-blue-400/90 uppercase tracking-widest font-mono break-words mb-2">{member.role}</p>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 group-hover:text-blue-400 transition-colors">
                    <User size={11} aria-hidden="true" /> Details <ChevronRight size={11} className="group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                </span>
            </div>
        </button>
    );
}
