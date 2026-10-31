"use client";

import { useRef, useState } from "react";
import Markdown from "@/components/ui/Markdown";
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Link as LinkIcon, Quote, Code, Eye, PenLine } from "lucide-react";

type ToolbarAction = "bold" | "italic" | "h1" | "h2" | "ul" | "ol" | "link" | "quote" | "code";

const MARKDOWN_SYNTAX: Record<ToolbarAction, { before: string; after: string; linePrefix?: string; placeholder: string }> = {
    bold: { before: "**", after: "**", placeholder: "bold text" },
    italic: { before: "*", after: "*", placeholder: "italic text" },
    h1: { before: "", after: "", linePrefix: "# ", placeholder: "Heading" },
    h2: { before: "", after: "", linePrefix: "## ", placeholder: "Subheading" },
    ul: { before: "", after: "", linePrefix: "- ", placeholder: "List item" },
    ol: { before: "", after: "", linePrefix: "1. ", placeholder: "Numbered item" },
    quote: { before: "", after: "", linePrefix: "> ", placeholder: "Quoted text" },
    link: { before: "[", after: "](https://example.com)", placeholder: "link text" },
    code: { before: "`", after: "`", placeholder: "code" },
};

const TOOL_BUTTONS: { action: ToolbarAction; title: string; icon: React.ReactNode }[] = [
    { action: "bold", title: "Bold", icon: <Bold size={14} /> },
    { action: "italic", title: "Italic", icon: <Italic size={14} /> },
    { action: "h1", title: "Heading", icon: <Heading1 size={14} /> },
    { action: "h2", title: "Subheading", icon: <Heading2 size={14} /> },
    { action: "ul", title: "Bulleted list", icon: <List size={14} /> },
    { action: "ol", title: "Numbered list", icon: <ListOrdered size={14} /> },
    { action: "link", title: "Link", icon: <LinkIcon size={14} /> },
    { action: "quote", title: "Blockquote", icon: <Quote size={14} /> },
    { action: "code", title: "Inline code", icon: <Code size={14} /> },
];

/**
 * Markdown-capable editor with Write/Preview tabs, a formatting toolbar that
 * always preserves the administrator's raw Markdown source, and a concise
 * syntax cheat sheet. Used for both Full Details (single Markdown document)
 * and Key Points (one Markdown fragment per array item, joined by newlines —
 * same split/join convention the field always had) so both fields stay
 * backward-compatible and preview/public rendering stay consistent.
 */
export default function MarkdownEditor({
    id,
    label,
    value,
    onChange,
    rows = 8,
    placeholder,
    helpHint = "Markdown supported: headings, **bold**, *italic*, lists, [links](url), > quotes and `code`.",
    helpExamples = ["## Agenda", "- 10:00 AM: Check-in", "[ReLU Club](https://example.com)", "> Bring your laptop!", "`npm run dev`"],
    maxLength = 20000,
    labelClassName = "block text-sm font-bold text-gray-400",
    /** When true, the value is a newline-separated item list; the preview renders each item through the shared Markdown renderer exactly like the public Highlight list does. */
    previewAsList = false,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    placeholder?: string;
    helpHint?: string;
    helpExamples?: string[];
    maxLength?: number;
    labelClassName?: string;
    previewAsList?: boolean;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [view, setView] = useState<"write" | "preview">("write");

    const overLimit = value.length > maxLength;

    const applyToolbarAction = (action: ToolbarAction) => {
        const syntax = MARKDOWN_SYNTAX[action];
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? 0;
        const selected = value.slice(start, end);
        const selection = selected || syntax.placeholder;

        let next: string;
        let caretStart: number;
        let caretEnd: number;

        if (syntax.linePrefix) {
            // Prefix each line in the selection (heading/list/quote).
            const startOfFirstLine = value.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
            const blockEnd = value.indexOf("\n", end);
            const blockEndIdx = blockEnd === -1 ? value.length : blockEnd;
            const block = value.slice(startOfFirstLine, blockEndIdx);
            // Toggle the prefix off when every line already has it, so a second click removes it.
            const lines = block.split("\n");
            const allPrefixed = block.trim().length > 0 && lines.every(l => l.trim().length === 0 || l.startsWith(syntax.linePrefix!));
            const transformed = allPrefixed
                ? lines.map(l => (l.startsWith(syntax.linePrefix!) ? l.slice(syntax.linePrefix!.length) : l)).join("\n")
                : lines.map(l => (l.trim().length === 0 ? l : syntax.linePrefix! + l)).join("\n");
            next = value.slice(0, startOfFirstLine) + transformed + value.slice(blockEndIdx);
            caretStart = startOfFirstLine;
            caretEnd = startOfFirstLine + transformed.length;
        } else {
            next = value.slice(0, start) + syntax.before + selection + syntax.after + value.slice(end);
            caretStart = start + syntax.before.length;
            caretEnd = caretStart + selection.length;
        }

        onChange(next);

        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(caretStart, caretEnd);
        });
    };

    return (
        <div>
            <div className="flex flex-wrap justify-between items-end gap-2 mb-2">
                <label htmlFor={id} className={labelClassName}>
                    {label}
                </label>
                <div
                    role="tablist"
                    aria-label={`${label} editor mode`}
                    className="flex rounded-lg bg-black/40 border border-white/10 overflow-hidden"
                >
                    <button
                        type="button"
                        role="tab"
                        id={`${id}-tab-write`}
                        aria-selected={view === "write"}
                        aria-controls={`${id}-panel`}
                        onClick={() => setView("write")}
                        className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                            view === "write" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
                        }`}
                    >
                        <PenLine size={12} /> Write
                    </button>
                    <button
                        type="button"
                        role="tab"
                        id={`${id}-tab-preview`}
                        aria-selected={view === "preview"}
                        aria-controls={`${id}-panel`}
                        onClick={() => setView("preview")}
                        className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                            view === "preview" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
                        }`}
                    >
                        <Eye size={12} /> Preview
                    </button>
                </div>
            </div>

            <div
                id={`${id}-panel`}
                role="tabpanel"
                aria-labelledby={`${id}-tab-${view}`}
            >
                {view === "write" ? (
                    <>
                        <div className="flex flex-wrap items-center gap-1 mb-2 p-1.5 bg-black/40 border border-white/10 rounded-lg" role="toolbar" aria-label={`${label} formatting toolbar`}>
                            {TOOL_BUTTONS.map(({ action, title, icon }) => (
                                <button
                                    key={action}
                                    type="button"
                                    title={title}
                                    aria-label={title}
                                    onClick={() => applyToolbarAction(action)}
                                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                                >
                                    {icon}
                                </button>
                            ))}
                            {overLimit && (
                                <span className="ml-auto px-2 py-1 text-xs text-red-400">
                                    {value.length}/{maxLength} characters — too long, shorten the content.
                                </span>
                            )}
                        </div>
                        <textarea
                            id={id}
                            ref={textareaRef}
                            rows={rows}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-sm resize-y"
                            value={value}
                            onChange={e => {
                                onChange(e.target.value);
                            }}
                            placeholder={placeholder}
                            aria-invalid={overLimit}
                            aria-describedby={overLimit ? `${id}-length-error` : `${id}-hint`}
                        />
                    </>
                ) : (
                    <div
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-4 min-h-[12rem] max-h-[28rem] overflow-y-auto"
                        aria-live="polite"
                    >
                        {value.trim() ? (
                            previewAsList ? (
                                <ul className="space-y-2">
                                    {value.split("\n").filter(line => line.trim().length > 0).map((item, idx) => (
                                        <li key={idx} className="flex items-start gap-3">
                                            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                            <div className="min-w-0">
                                                <Markdown>{item}</Markdown>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <Markdown>{value}</Markdown>
                            )
                        ) : (
                            <p className="text-sm text-gray-500">Nothing to preview yet.</p>
                        )}
                    </div>
                )}
            </div>

            {overLimit && (
                <p id={`${id}-length-error`} role="alert" className="text-red-400 text-xs mt-1.5">
                    Content exceeds the {maxLength.toLocaleString()}-character limit ({value.length.toLocaleString()} used).
                </p>
            )}
            <details className="mt-2 text-xs text-gray-500">
                <summary className="cursor-pointer select-none hover:text-gray-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded">
                    {helpHint}
                </summary>
                <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-gray-600 pl-4">
                    {helpExamples.map((example, idx) => (
                        <li key={idx}>{example}</li>
                    ))}
                </ul>
            </details>
        </div>
    );
}
