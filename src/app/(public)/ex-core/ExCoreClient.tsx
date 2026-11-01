"use client";

import { useMemo, useState } from "react";
import type { ExCoreMember } from "@/lib/excore";
import { groupByBatchDesc } from "@/lib/excore";
import TeamMemberCard from "@/components/public/TeamCards";
import MemberModal, { safeHttpUrl } from "@/components/public/MemberModal";
import { History, ChevronRight } from "lucide-react";

/**
 * Public Ex-Core listing. Newest batch first; inside a batch the persisted
 * custom order (displayOrder) wins — alphabetical is never applied when the
 * CTO has ordered the batch. Visual hierarchy mirrors /about exactly:
 * former Core roles (President, VP, CTO…) render the full photo card, while
 * Activators render the compact small block used for activators there.
 */

interface ExCoreDisplayMember {
    id: string;
    name: string;
    roleLabel: string;
    image: string;
    bio: string;
    links: { linkedin: string | null; github: string | null; instagram: string | null };
    memberType: "core" | "activator";
    exCoreBatch: number;
    roleHistory: { year: number; role: string }[];
}

export default function ExCoreClient({ members }: { members: ExCoreMember[] }) {
    const [selected, setSelected] = useState<ExCoreDisplayMember | null>(null);

    const batches = useMemo(() => groupByBatchDesc(members), [members]);

    const cardLabel = (m: ExCoreMember) =>
        (m.roleHistory && m.roleHistory.length > 0)
            ? m.roleHistory[0].role
            : (m.memberType === "activator" ? "Activator" : "Ex-Core");

    const openMember = (m: ExCoreMember, batchYear: number) =>
        setSelected({
            id: m.id,
            name: m.name || "Member",
            roleLabel: cardLabel(m),
            image: m.photoURL || "",
            bio: m.bio || "",
            links: {
                linkedin: safeHttpUrl(m.socials?.linkedin),
                github: safeHttpUrl(m.socials?.github),
                instagram: safeHttpUrl(m.socials?.instagram),
            },
            memberType: m.memberType === "activator" ? "activator" : "core",
            exCoreBatch: batchYear,
            roleHistory: (m.roleHistory || []).slice(),
        });

    return (
        <div className="about-section min-h-screen pt-32 md:pt-36 pb-20 relative z-[1]">
            <h1 className="sr-only">Ex-Core — former ReLU Core members &amp; Activators</h1>

            <div className="max-w-7xl mx-auto px-4 mb-16 text-center relative">
                <h2 className="section-title text-4xl md:text-[3rem] mb-6 text-white uppercase tracking-[5px] md:tracking-[10px] font-bold relative break-words">
                    Ex-Core
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-gradient-to-tr from-[#0099ff1a] via-[#0044ff1a] to-[#00ccff1a] blur-[40px] rounded-full -z-10 animate-[titleGlow_4s_ease-in-out_infinite pointer-events-none]" />
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    The members who built ReLU before handing it on, organized by the batch they stepped down in.
                </p>
            </div>

            {batches.length === 0 ? (
                <p className="text-center text-gray-500">No Ex-Core members listed yet.</p>
            ) : (
                batches.map(group => (
                    <section key={group.year} className="mb-20 last:mb-8" aria-label={group.label}>
                        <h3 className="section-title text-2xl md:text-3xl mb-10 text-transparent bg-clip-text bg-gradient-to-b from-blue-300 to-blue-600 uppercase tracking-[4px] md:tracking-[8px] font-bold text-center">
                            {group.label}
                        </h3>

                        {/* Former CORE roles — full photo card, same as /about Core Team */}
                        {group.core.length > 0 && (
                            <div className="max-w-7xl mx-auto px-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 justify-items-center">
                                    {group.core.map(m => (
                                        <TeamMemberCard
                                            key={m.id}
                                            member={{
                                                name: m.name || "Member",
                                                role: cardLabel(m),
                                                image: m.photoURL || "",
                                            }}
                                            onOpen={() => openMember(m, group.year)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ACTIVATORS — compact small block, same as /about Activators */}
                        {group.activators.length > 0 && (
                            <div className={`max-w-5xl mx-auto px-4 ${group.core.length > 0 ? "mt-12" : ""}`}>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {group.activators.map(m => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => openMember(m, group.year)}
                                            aria-label={`View details for ${m.name || "activator"}`}
                                            className="bg-white/5 border border-white/10 rounded-lg p-4 text-center hover:bg-white/10 hover:border-blue-500/30 transition-all duration-300 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:-translate-y-1 group cursor-pointer"
                                        >
                                            <div className="font-bold text-gray-200 text-sm group-hover:text-blue-400 transition-colors break-words">
                                                {m.name || "Activator"}
                                            </div>
                                            <p className="mt-1.5 text-[10px] uppercase tracking-widest text-gray-500 group-hover:text-blue-400/80 transition-colors flex items-center justify-center gap-1">
                                                Details <ChevronRight size={10} className="group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                ))
            )}

            {batches.length === 0 && (
                <div className="max-w-xl mx-auto text-center text-gray-600 text-sm flex items-center justify-center gap-2" aria-hidden="true">
                    <History size={14} /> Former core members and activators appear here by batch.
                </div>
            )}

            {selected && (
                <MemberModal
                    member={{
                        uid: selected.id,
                        email: "",
                        role: selected.memberType === "activator" ? "Activator" : "",
                        status: "active",
                        createdAt: null,
                        displayName: selected.name,
                        photoURL: selected.image || null,
                        socials: {
                            linkedin: selected.links.linkedin || undefined,
                            github: selected.links.github || undefined,
                            instagram: selected.links.instagram || undefined,
                        },
                    }}
                    roles={[]}
                    publicView
                    exCore={{
                        bio: selected.bio,
                        memberType: selected.memberType,
                        roleHistory: selected.roleHistory,
                    }}
                    onClose={() => setSelected(null)}
                />
            )}
        </div>
    );
}
