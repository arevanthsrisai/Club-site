"use client";

import ReactMarkdown from "react-markdown";

/**
 * Shared Markdown renderer.
 *
 * Rendered content is untrusted (event descriptions are admin-authored but may
 * contain previously stored text), so:
 *  - react-markdown's default safe pipeline is used: no raw HTML is passed
 *    through, so `<script>`/`<img onerror>` etc. never reach the DOM.
 *  - react-markdown's default URL transform strips `javascript:`, `data:` and
 *    other unsafe protocols; this layer keeps only http(s) Links absolute for
 *    the security attrs and renders everything else as a normal relative link.
 *  - No `dangerouslySetInnerHTML` anywhere in this pipeline.
 *
 * The admin editor preview and the public event page render these fields
 * through THIS component so preview and published output stay identical.
 *
 * Styles are declared here (not via a typography plugin) to keep rendering
 * self-contained and consistent with the site's dark surface design.
 */
export default function Markdown({
    children,
    className = "",
}: {
    children: string;
    className?: string;
}) {
    return (
        <div className={`md-render text-gray-300 ${className}`}>
            <ReactMarkdown
                components={{
                    h1: ({ children }) => (
                        <h2 className="text-xl md:text-2xl font-bold text-white mt-6 mb-3 first:mt-0">{children}</h2>
                    ),
                    h2: ({ children }) => (
                        <h3 className="text-lg md:text-xl font-bold text-white mt-5 mb-3 first:mt-0">{children}</h3>
                    ),
                    h3: ({ children }) => (
                        <h4 className="text-base md:text-lg font-semibold text-white mt-4 mb-2 first:mt-0">{children}</h4>
                    ),
                    h4: ({ children }) => (
                        <h5 className="text-base font-semibold text-white mt-4 mb-2 first:mt-0">{children}</h5>
                    ),
                    h5: ({ children }) => (
                        <h6 className="text-sm font-semibold text-gray-200 mt-3 mb-1.5 first:mt-0 uppercase tracking-wide">{children}</h6>
                    ),
                    h6: ({ children }) => (
                        <h6 className="text-sm font-semibold text-gray-300 mt-3 mb-1.5 first:mt-0">{children}</h6>
                    ),
                    p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>,
                    a: ({ href, children }) => {
                        const safeHref = typeof href === "string" ? href : undefined;
                        // http(s) links open in a new tab with security attrs;
                        // anything else stays a plain link (react-markdown has
                        // already stripped unsafe protocols).
                        const isExternal = /^https?:\/\//i.test(safeHref ?? "");
                        return (
                            <a
                                href={safeHref}
                                className="text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
                                target={isExternal ? "_blank" : undefined}
                                rel={isExternal ? "noopener noreferrer" : undefined}
                            >
                                {children}
                            </a>
                        );
                    },
                    ul: ({ children }) => <ul className="list-disc list-outside pl-6 mb-4 last:mb-0 space-y-1.5 marker:text-blue-400/70">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal list-outside pl-6 mb-4 last:mb-0 space-y-1.5 marker:text-blue-400/70">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-blue-500/50 bg-blue-500/5 pl-4 py-1 pr-2 rounded-r-md mb-4 last:mb-0 text-gray-400 italic">
                            {children}
                        </blockquote>
                    ),
                    code: ({ className, children }) => {
                        // Fenced blocks arrive with a `language-*` class; style
                        // only true inline code here (the block wrapper is styled
                        // by the `pre` mapping below).
                        if (className?.startsWith("language-")) {
                            return <code className="font-mono text-sm text-cyan-300">{children}</code>;
                        }
                        return (
                            <code className="bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-[0.85em] text-cyan-300 font-mono">
                                {children}
                            </code>
                        );
                    },
                    pre: ({ children }) => (
                        <pre className="bg-black/50 border border-white/10 rounded-lg p-3 mb-4 last:mb-0 overflow-x-auto text-sm">
                            {children}
                        </pre>
                    ),
                    hr: () => <hr className="border-white/10 my-6" />,
                    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                    em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
                    table: ({ children }) => (
                        <div className="overflow-x-auto mb-4 last:mb-0">
                            <table className="w-full text-sm border-collapse border border-white/10">{children}</table>
                        </div>
                    ),
                    th: ({ children }) => <th className="border border-white/10 bg-white/5 px-3 py-1.5 text-left font-semibold text-white">{children}</th>,
                    td: ({ children }) => <td className="border border-white/10 px-3 py-1.5">{children}</td>,
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
}
