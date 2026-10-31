import Link from "next/link";
import Image from "next/image";
import { ArrowRight, FileText, Image as ImageIcon, Link as LinkIcon, Download } from "lucide-react";
import { Resource } from "@/types";

export default function ResourceCard({ resource }: { resource: Resource }) {

    // Stored URLs come from the admin form; only http(s) links are escapable
    // into an <a href>. Anything else (javascript:, data:, empty) renders as a
    // non-clickable informational card instead of an exploitable link.
    const href = /^https?:\/\//i.test(resource.url) ? resource.url : null;

    // Determine the icon and label based on type
    const Meta = {
        image: { icon: ImageIcon, label: "Image", color: "text-purple-400", bg: "bg-purple-500/10" },
        pdf: { icon: FileText, label: "PDF", color: "text-red-400", bg: "bg-red-500/10" },
        url: { icon: LinkIcon, label: "External", color: "text-blue-400", bg: "bg-blue-500/10" }
    }[resource.type];

    // Determine the display image
    const displayImage = resource.type === 'image'
        ? resource.url
        : resource.thumbnailUrl || "/images/event-placeholder.jpg"; // Fallback if no thumbnail

    const cardClass = "group relative block bg-black/40 border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl h-full flex flex-col";

    return (
        <Link
            href={href ?? "#"}
            target={href ? "_blank" : undefined}
            rel={href ? "noopener noreferrer" : undefined}
            aria-disabled={!href}
            tabIndex={!href ? -1 : undefined}
            aria-label={!href ? `${resource.title} (unavailable)` : undefined}
            className={`${cardClass} pointer-events-${href ? "auto" : "none"}`}
        >
            {/* Image/Thumbnail Area */}
            <div className="relative h-48 w-full overflow-hidden bg-black/50">
                {/* Provide visual hint for PDF without thumbnail */}
                {resource.type === 'pdf' && !resource.thumbnailUrl ? (
                    <div className="w-full h-full flex items-center justify-center bg-red-900/10">
                        <FileText size={64} className="text-red-500/30" />
                    </div>
                ) : (
                    <Image
                        src={displayImage}
                        alt={resource.title}
                        fill
                        sizes="(max-width: 767px) calc(100vw - 48px), (max-width: 1023px) calc((100vw - 72px) / 2), calc((100vw - 96px) / 3)"
                    />
                )}

                {/* Type Badge */}
                <div className={`absolute top-4 right-4 px-3 py-1 rounded-full text-xs font-bold border backdrop-blur-md ${Meta.bg} ${Meta.color} border-white/10 flex items-center gap-2 shadow-lg`}>
                    <Meta.icon size={12} />
                    <span className="uppercase tracking-wider">{Meta.label}</span>
                </div>
            </div>

            {/* Content Area */}
            <div className="p-6 flex flex-col flex-grow">
                {/* Category */}
                <div className="mb-3">
                    <span className="text-xs font-mono text-gray-400 uppercase tracking-widest border-l-2 border-blue-500 pl-2">
                        {resource.category}
                    </span>
                </div>

                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors line-clamp-2">
                    {resource.title}
                </h3>

                <p className="text-gray-400 text-sm leading-relaxed mb-6 line-clamp-3 flex-grow">
                    {resource.description}
                </p>

                <div className="pt-4 border-t border-white/5 flex items-center justify-between mt-auto">
                    <span className="text-gray-500 text-xs font-mono group-hover:text-gray-300 transition-colors">
                        {href
                            ? (resource.type === 'pdf' ? 'Click to View/Download' : 'Click to Open')
                            : 'Link unavailable'}
                    </span>
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-all duration-300">
                        {resource.type === 'pdf' ? <Download size={14} /> : <ArrowRight size={14} />}
                    </div>
                </div>
            </div>
        </Link>
    );
}
