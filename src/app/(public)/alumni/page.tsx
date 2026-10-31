import { GraduationCap, Linkedin, Briefcase, Building2 } from "lucide-react";
import { getAlumni } from "@/lib/api";
import { Alumni } from "@/types";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Alumni Network",
    description: "Connect with past members of the ReLU AI&ML Club.",
};

export const revalidate = 0;

/** Stored URLs become links only when they are real http(s) URLs. */
function safeHttpUrl(raw: string | undefined): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

export default async function AlumniPage() {
    let alumni: Alumni[] = [];
    try {
        alumni = await getAlumni();
    } catch {
        alumni = [];
    }

    return (
        <div className="min-h-screen pt-32 md:pt-36 pb-20 relative z-[1]">
            {/* Header */}
            <div className="text-center mb-16 relative">
                <h1 className="text-[3rem] md:text-[4rem] text-white uppercase tracking-[10px] font-bold animate-[aurora_8s_linear_infinite] relative inline-block">
                    Alumni Network
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-full bg-purple-500/20 blur-[50px] rounded-full -z-10" />
                </h1>
                <p className="text-gray-400 text-lg mt-4 max-w-2xl mx-auto px-4">
                    Past members who helped build ReLU, and where they are now.
                </p>
            </div>

            {/* Alumni Grid */}
            <div className="max-w-[1400px] mx-auto px-6 pb-20">
                {alumni.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {alumni.map((alumnus) => (
                            <div
                                key={alumnus.id}
                                className="group relative bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-blue-500/30 hover:bg-white/[0.07] transition-all duration-500 hover:-translate-y-1"
                            >
                                {/* Avatar */}
                                <div className="flex justify-center mb-4">
                                    {alumnus.photoURL ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={alumnus.photoURL}
                                            alt={alumnus.name}
                                            loading="lazy"
                                            decoding="async"
                                            className="w-20 h-20 rounded-full object-cover border-2 border-white/10 group-hover:border-blue-500/50 transition-colors shadow-xl"
                                        />
                                    ) : (
                                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-2xl shadow-xl group-hover:shadow-blue-500/20 transition-shadow">
                                            {alumnus.name.charAt(0)}
                                        </div>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="text-center">
                                    <h3 className="text-lg font-bold text-white mb-1">{alumnus.name}</h3>
                                    <p className="text-sm text-blue-400 font-semibold mb-3">{alumnus.roleHeld}</p>

                                    <div className="space-y-1.5 text-xs text-gray-400">
                                        <p className="flex items-center justify-center gap-1.5">
                                            <GraduationCap size={13} className="text-gray-500" />
                                            Batch {alumnus.batchYear}
                                        </p>
                                        {alumnus.currentPosition && (
                                            <p className="flex items-center justify-center gap-1.5">
                                                <Briefcase size={13} className="text-gray-500" />
                                                {alumnus.currentPosition}
                                            </p>
                                        )}
                                        {alumnus.company && (
                                            <p className="flex items-center justify-center gap-1.5">
                                                <Building2 size={13} className="text-gray-500" />
                                                {alumnus.company}
                                            </p>
                                        )}
                                    </div>

                                    {safeHttpUrl(alumnus.linkedinUrl) && (
                                        <a
                                            href={safeHttpUrl(alumnus.linkedinUrl)!}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 mt-4 px-4 py-1.5 rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition-all text-xs font-medium border border-blue-500/20"
                                        >
                                            <Linkedin size={13} /> Connect
                                        </a>
                                    )}
                                </div>

                                {/* Subtle glow on hover */}
                                <div className="absolute inset-0 rounded-2xl bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/10">
                        <GraduationCap size={48} className="mx-auto text-gray-600 mb-4" />
                        <p className="text-xl text-gray-400">Alumni profiles coming soon.</p>
                        <p className="text-sm text-gray-500 mt-2">We&apos;re building a dedicated space for our past members.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
