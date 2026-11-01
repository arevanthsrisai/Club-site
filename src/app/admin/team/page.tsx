"use client";

import { useState, useEffect } from "react";
import { AdminProfile, subscribeToAllAdmins, subscribeToRoles } from "@/lib/api";
import { ClubRole, roleLabel, withBuiltIns, sortMembersByRole } from "@/lib/roles";
import { Users, ChevronRight } from "lucide-react";
import Image from "next/image";
import PageHeader from "@/components/ui/PageHeader";
import MemberModal, { RoleIcon } from "@/components/public/MemberModal";

export default function TeamPage() {
    const [admins, setAdmins] = useState<AdminProfile[]>([]);
    const [roles, setRoles] = useState<ClubRole[]>(withBuiltIns([]));
    const [loading, setLoading] = useState(true);
    const [selectedMember, setSelectedMember] = useState<AdminProfile | null>(null);

    useEffect(() => {
        const unsubscribeAdmins = subscribeToAllAdmins((data) => {
            setAdmins(data);
            setLoading(false);
        });
        const unsubscribeRoles = subscribeToRoles(setRoles);

        return () => {
            unsubscribeAdmins();
            unsubscribeRoles();
        };
    }, []);

    // Canonical ordering shared with /about: role precedence, then stable
    // member order inside each role. Accounts the CTO moved into Ex-Core
    // (exCoreAt set) are excluded, mirroring the public About page.
    const members = sortMembersByRole(
        admins.filter(u => u.status === "active" && u.role !== "pending" && u.role !== "admin" && !u.exCoreAt),
        roles,
    );

    return (
        <div className="min-h-screen pb-12">
            <PageHeader
                title="Club Team"
                subtitle={`${members.length} active member${members.length === 1 ? "" : "s"} · open a card for contact details`}
                icon={<Users size={26} />}
            />

            {loading ? (
                // Skeleton mirrors the real card layout so nothing jumps on load.
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8" aria-busy="true">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                            <div className="w-32 h-32 mx-auto rounded-full bg-white/10 animate-pulse mb-6" />
                            <div className="h-5 w-3/4 mx-auto rounded bg-white/10 animate-pulse mb-2" />
                            <div className="h-3.5 w-1/2 mx-auto rounded bg-white/10 animate-pulse" />
                        </div>
                    ))}
                </div>
            ) : members.length === 0 ? (
                <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
                    <Users size={36} className="mx-auto text-gray-600 mb-4" aria-hidden="true" />
                    <p className="text-gray-400 font-medium">No active team members yet.</p>
                    <p className="text-gray-600 text-sm mt-1">Approved admins with team roles appear here.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                    {members.map(member => (
                        <button
                            key={member.uid}
                            type="button"
                            onClick={() => setSelectedMember(member)}
                            aria-label={`View contact details for ${member.displayName || member.email}`}
                            className="group bg-white/5 border border-white/10 rounded-2xl p-6 text-center hover:bg-white/10 hover:border-blue-500/40 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none flex flex-col items-center"
                        >
                            <div className="relative w-32 h-32 rounded-full p-1 bg-[#000080] mb-5 shadow-[0_0_20px_rgba(0,0,128,0.5)]">
                                <div className="w-full h-full rounded-full overflow-hidden bg-gray-900 relative">
                                    {member.photoURL ? (
                                        <Image src={member.photoURL} alt="" fill className="object-cover" sizes="128px" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold text-3xl" aria-hidden="true">
                                            {(member.displayName || member.email)[0].toUpperCase()}
                                        </div>
                                    )}
                                </div>
                                <div className="absolute -bottom-2 -right-2 bg-[#111] rounded-full p-1.5 border border-white/10 shadow-lg">
                                    <RoleIcon role={member.role} />
                                </div>
                            </div>

                            <h3 className="text-lg font-bold text-white text-center break-words min-h-[1.2em] mb-1.5 group-hover:text-blue-400 transition-colors">
                                {member.displayName || member.email}
                            </h3>
                            <p className="text-blue-400 text-[11px] text-center uppercase tracking-widest font-mono break-words mb-3">
                                {roleLabel(roles, member.role)}
                            </p>
                            <p className="text-xs text-gray-400 break-all line-clamp-2 mt-auto">
                                {member.email}
                            </p>
                            <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 group-hover:text-blue-400 transition-colors">
                                Details <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* MEMBER DETAIL MODAL — keyboard closable, focus moves inside on open */}
            {selectedMember && <MemberModal member={selectedMember} roles={roles} onClose={() => setSelectedMember(null)} />}
        </div>
    );
}
