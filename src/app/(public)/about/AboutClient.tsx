"use client";

import { useMemo, useState } from "react";
import { AdminProfile } from "@/types";
import Image from "next/image";
import { User, ChevronRight } from "lucide-react";
import { ClubRole, DEFAULT_ROLE_ID, roleLabel, sortMembersByRole } from "@/lib/roles";
import MemberModal, { RoleIcon, safeHttpUrl } from "@/components/public/MemberModal";

interface AboutClientProps {
    team: AdminProfile[];
    roles: ClubRole[];
}

/**
 * Public /about team section. Every member category — Core Team, Activators
 * and any future group rendered here — uses the SAME interaction as the admin
 * team page: click/keyboard-activate a card to open the shared member detail
 * dialog. Ordering is the canonical role precedence, with a stable member
 * order inside each role. Only public-safe fields reach this page.
 */
export default function AboutClient({ team, roles }: AboutClientProps) {
    const { coreTeam, activators } = useMemo(() => {
        // Canonical ordering + grouping. Other categories (e.g. any role that
        // is not "Activator") land in Core Team automatically.
        const sorted = sortMembersByRole(team, roles);
        const core = sorted.filter(u => u.role !== DEFAULT_ROLE_ID && u.role !== "pending");
        const acts = sorted.filter(u => u.role === DEFAULT_ROLE_ID);
        return { coreTeam: core, activators: acts };
    }, [team, roles]);

    const [selectedMember, setSelectedMember] = useState<AdminProfile | null>(null);

    return (
        <div className="about-section min-h-screen pt-32 md:pt-36 pb-20 relative z-[1]">

            {/* SR-only page heading for screen readers */}
            <h1 className="sr-only">About ReLU — Core Team &amp; Founders</h1>

            {/* CORE TEAM — interactive cards */}
            {coreTeam.length > 0 && (
                <>
                    <h2 className="section-title text-center text-4xl md:text-[3rem] mb-12 md:mb-[4rem] text-white uppercase tracking-[5px] md:tracking-[10px] font-bold animate-[aurora_8s_linear_infinite] relative break-words px-4">
                        Core Team
                    </h2>
                    <div className="max-w-7xl mx-auto px-4 mb-24">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 justify-items-center">
                            {coreTeam.map(u => (
                                <TeamMemberCard
                                    key={u.uid}
                                    member={mapToMemberStats(u, roles)}
                                    onOpen={() => setSelectedMember(u)}
                                />
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* ACTIVATORS — now interactive cards too */}
            {activators.length > 0 && (
                <>
                    <h2 className="section-title text-3xl md:text-[2.5rem] mb-12 md:mb-[4rem] text-white uppercase tracking-[5px] md:tracking-[10px] font-bold animate-[aurora_8s_linear_infinite] relative break-words px-4">
                        Activators
                        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-gradient-to-tr from-[#0099ff1a] via-[#0044ff1a] to-[#00ccff1a] blur-[40px] rounded-full -z-10 animate-[titleGlow_4s_ease-in-out_infinite pointer-events-none]" />
                    </h2>
                    <div className="max-w-5xl mx-auto px-4 mb-24">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {activators.map(u => (
                                <button
                                    key={u.uid}
                                    type="button"
                                    onClick={() => setSelectedMember(u)}
                                    aria-label={`View contact details for ${u.displayName || u.email}`}
                                    className="bg-white/5 border border-white/10 rounded-lg p-4 text-center hover:bg-white/10 hover:border-blue-500/30 transition-all duration-300 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:-translate-y-1 group cursor-pointer"
                                >
                                    <h3 className="font-bold text-gray-200 text-sm group-hover:text-blue-400 transition-colors break-words">
                                        {u.displayName || "Activator"}
                                    </h3>
                                    <p className="mt-1.5 text-[10px] uppercase tracking-widest text-gray-500 group-hover:text-blue-400/80 transition-colors flex items-center justify-center gap-1">
                                        Details <ChevronRight size={10} className="group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* FOUNDERS - Legacy Section */}
            <h2 className="section-title mt-24 text-3xl md:text-[2.5rem] mb-12 text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-yellow-600 uppercase tracking-[5px] md:tracking-[10px] font-bold relative px-4 text-center">
                The Founders
            </h2>
            <div className="max-w-7xl mx-auto px-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 justify-items-center">
                    {[
                        { name: "Janke Yashwanth Reddy", img: "janke-yashwanth-reddy.jpg" },
                        { name: "Jerripothula Rakesh Naidu", img: "jerripothula-rakesh-naidu.jpg" },
                        { name: "Sricharan Vangoori", img: "sricharan-vangoori.jpg" },
                        { name: "Talasu Sai Nithin", img: "talasu-sai-nithin.png" },
                        { name: "Vadde Venkatasai", img: "vadde-venkatasai.jpg" },
                        { name: "Vivek Vignesh Baggam", img: "vivek-vignesh-baggam.jpg" }
                    ].map((founder, i) => (
                        <div key={i} className="relative group w-full max-w-sm">
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-2xl opacity-50 group-hover:opacity-100 transition duration-300 blur-sm group-hover:blur-md" />
                            <div className="relative h-full bg-black/80 backdrop-blur-xl rounded-2xl p-6 border border-yellow-500/30 flex flex-col items-center text-center">
                                <div className="w-24 h-24 rounded-full border-2 border-yellow-500/50 mb-4 overflow-hidden shadow-[0_0_15px_rgba(234,179,8,0.3)] relative">
                                    <Image
                                        src={`/images/founders/${founder.img}`}
                                        alt={founder.name}
                                        fill
                                        sizes="96px"
                                        className="object-cover"
                                    />
                                </div>
                                <h3 className="text-lg font-bold text-yellow-500 mb-1">{founder.name}</h3>
                                <p className="text-xs text-yellow-200/60 uppercase tracking-widest font-mono">Founding Member</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Shared detail dialog — same layout hierarchy as /admin/team */}
            {selectedMember && (
                <MemberModal
                    member={selectedMember}
                    roles={roles}
                    publicView
                    onClose={() => setSelectedMember(null)}
                />
            )}
        </div>
    );
}

function mapToMemberStats(u: AdminProfile, roles: ClubRole[]) {
    return {
        name: u.displayName || "Member",
        role: roleLabel(roles, u.role),
        image: u.photoURL || "", // Empty string triggers the fallback avatar
        links: {
            linkedin: safeHttpUrl(u.socials?.linkedin),
            github: safeHttpUrl(u.socials?.github),
            instagram: safeHttpUrl(u.socials?.instagram),
            mail: u.email,
        },
    };
}

/** Card visual kept in the site's existing design language (gradient ring + halo). */
function TeamMemberCard({
    member,
    onOpen,
}: {
    member: { name: string; role: string; image: string };
    onOpen: () => void;
}) {
    const initials = member.name.charAt(0).toUpperCase();
    const accent = member.name.length % 2 === 0 ? "blue" : "purple";

    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label={`View contact details for ${member.name}`}
            className="group relative w-full max-w-sm text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-2xl"
        >
            <div
                className={`absolute -inset-0.5 rounded-2xl opacity-40 group-hover:opacity-90 blur-md transition duration-300 ${
                    accent === "blue"
                        ? "bg-gradient-to-r from-blue-500 to-cyan-400"
                        : "bg-gradient-to-r from-purple-500 to-pink-500"
                }`}
                aria-hidden="true"
            />
            <div className="relative bg-black/80 backdrop-blur-xl rounded-2xl p-6 border border-blue-500/30 flex flex-col items-center transition-transform duration-300 group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0">
                <div className="relative w-24 h-24 mb-4">
                    <div className="w-full h-full rounded-full border-2 border-blue-500/50 overflow-hidden shadow-[0_0_15px_rgba(59,130,246,0.3)] bg-black relative">
                        {member.image ? (
                            <Image src={member.image} alt="" fill className="object-cover" sizes="96px" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500/30 to-purple-600/30 text-3xl font-bold text-white/90" aria-hidden="true">
                                {initials}
                            </div>
                        )}
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-[#111] rounded-full p-1.5 border border-white/10 shadow z-10">
                        <RoleIcon role={member.role} />
                    </div>
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
