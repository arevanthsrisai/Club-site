"use client";

import Image from "next/image";
import { Linkedin, Github, Mail, GraduationCap, Instagram } from "lucide-react";

/** Only http(s) URLs are ever turned into links from stored profile data. */
function safeHttpUrl(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    try {
        const url = new URL(raw);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Builds a real mailto: link from a stored email address. Stored addresses are
 * plain strings — using one directly as an href makes the browser treat it as
 * a relative site route (/admin@example.com), which 404s. Anything that is not
 * a plausible email yields undefined so no misleading button is rendered.
 */
function mailtoLink(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const email = raw.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
    return `mailto:${encodeURIComponent(email)}`;
}

interface TeamMemberProps {
    member: {
        name: string;
        role: string;
        image: string;
        links: {
            linkedin?: string;
            github?: string;
            mail?: string;
            scholar?: string;
            instagram?: string; // Added instagram since it was in UserProfile
        };
    };
}

export default function TeamMember({ member }: TeamMemberProps) {
    return (
        <div className="team-member bg-black/60 rounded-[20px] p-[clamp(15px,3vw,30px)] text-center backdrop-blur-[10px] border border-white/10 transition-colors duration-300 group relative overflow-hidden hover:border-[#0099FF40] h-full flex flex-col items-center">
            {/* Hover Background Effect */}
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-tr from-transparent via-[rgba(0,153,255,0.1)] to-transparent -translate-y-full transition-transform duration-600 ease-in-out group-hover:translate-y-full" />

            <div className="member-image relative w-[clamp(120px,25vw,180px)] h-[clamp(120px,25vw,180px)] rounded-full mx-auto mb-[25px] overflow-hidden border-[4px] border-[#0099FF] shadow-[0_0_30px_rgba(0,153,255,0.3)] transition-shadow duration-400 group-hover:shadow-[0_0_50px_rgba(0,153,255,0.5)] flex-shrink-0">
                {/* We use a standard img or Next.js Image. Since dynamic path, assume valid. */}
                <Image
                    src={member.image || "/images/placeholder-user.jpg"}
                    alt={member.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 150px, 180px"
                />
            </div>

            <h3 className="member-name text-white text-[clamp(1.1rem,2.5vw,1.4rem)] font-semibold mb-[10px] min-h-[auto] line-clamp-2 transition-all duration-300 group-hover:text-[#0099FF] group-hover:shadow-[0_0_10px_rgba(0,153,255,0.3)]">
                {member.name}
            </h3>

            <p className="member-role text-[#0099FF] text-[clamp(0.9rem,2vw,1rem)] font-medium opacity-90 mb-[20px] relative inline-block transition-all duration-300 after:content-[''] after:absolute after:-bottom-[8px] after:left-1/2 after:-translate-x-1/2 after:w-0 after:h-[2px] after:bg-[#0099FF] after:transition-[width] after:duration-300 group-hover:after:w-[80%]">
                {member.role.replace(/_/g, " ")}
            </p>

            <div className="member-social flex justify-center gap-[clamp(10px,2vw,20px)] mt-auto pt-[20px] border-t border-white/10 w-full">
                {safeHttpUrl(member.links.linkedin) && (
                    <a href={safeHttpUrl(member.links.linkedin)} target="_blank" rel="noopener noreferrer" className="social-link" aria-label={`LinkedIn profile of ${member.name}`}>
                        <Linkedin size={18} />
                    </a>
                )}
                {safeHttpUrl(member.links.github) && (
                    <a href={safeHttpUrl(member.links.github)} target="_blank" rel="noopener noreferrer" className="social-link" aria-label={`GitHub profile of ${member.name}`}>
                        <Github size={18} />
                    </a>
                )}
                {safeHttpUrl(member.links.instagram) && (
                    <a href={safeHttpUrl(member.links.instagram)} target="_blank" rel="noopener noreferrer" className="social-link" aria-label={`Instagram profile of ${member.name}`}>
                        <Instagram size={18} />
                    </a>
                )}
                {mailtoLink(member.links.mail) && (
                    <a
                        href={mailtoLink(member.links.mail)}
                        className="social-link"
                        aria-label={`Email ${member.name} at ${member.links.mail}`}
                    >
                        <Mail size={18} />
                    </a>
                )}
            </div>

            <style jsx>{`
        .social-link {
            color: #ffffff;
            font-size: clamp(1.1rem, 2.5vw, 1.3rem);
            transition: all 0.3s ease;
            position: relative;
            width: clamp(35px, 5vw, 40px);
            height: clamp(35px, 5vw, 40px);
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background: rgba(0, 153, 255, 0.1);
        }
        .social-link:hover {
            color: #0099FF;
            transform: translateY(-5px);
            background: rgba(0, 153, 255, 0.2);
            box-shadow: 0 5px 15px rgba(0, 153, 255, 0.3);
        }
      `}</style>
        </div>
    );
}
