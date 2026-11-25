"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, Loader2, Search, X } from "lucide-react";
import { StoredImage } from "@/types";
import { subscribeToImageAssets } from "@/services/imageAssets";
import { matchesImageSearch } from "@/lib/imageStash";

interface ImagePickerProps {
    onSelect: (asset: StoredImage) => void;
    onClose: () => void;
    selectedUrl?: string;
}

/**
 * Searchable picker over the admin Image Stash. Selection reuses the existing
 * asset (no upload, no duplicate bytes); the returned URL is the asset's
 * stable `/api/images/{id}` link.
 */
export default function ImagePicker({ onSelect, onClose, selectedUrl }: ImagePickerProps) {
    const [assets, setAssets] = useState<StoredImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const closeRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const unsubscribe = subscribeToImageAssets(
            (data) => {
                setAssets(data);
                setLoading(false);
            },
            () => {
                setError("Could not load the Image Stash. Refresh and try again.");
                setLoading(false);
            },
        );
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        closeRef.current?.focus();
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const filtered = useMemo(
        () => assets.filter(asset => matchesImageSearch(asset, search)),
        [assets, search],
    );

    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-picker-title"
            onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
            <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
                <div className="p-4 border-b border-white/10 flex items-start justify-between gap-4 shrink-0">
                    <div>
                        <h2 id="image-picker-title" className="text-xl font-bold text-white">Choose from Image Stash</h2>
                        <p className="text-sm text-gray-400">Pick an existing image — nothing new is uploaded.</p>
                    </div>
                    <button
                        ref={closeRef}
                        onClick={onClose}
                        aria-label="Close image picker"
                        className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 border-b border-white/10 shrink-0">
                    <label htmlFor="image-picker-search" className="sr-only">Search images</label>
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                        <input
                            ref={searchRef}
                            id="image-picker-search"
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by filename or URL…"
                            className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 bg-[#0a0a0a] custom-scrollbar">
                    {loading ? (
                        <div className="flex items-center justify-center min-h-[240px] text-gray-400">
                            <Loader2 className="animate-spin text-blue-500" size={28} aria-hidden="true" />
                            <span className="ml-3 text-sm">Loading images…</span>
                        </div>
                    ) : error ? (
                        <p role="alert" className="text-center text-red-400 py-16">{error}</p>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <ImageOff size={36} className="mx-auto mb-3 text-gray-600" aria-hidden="true" />
                            <p>{assets.length === 0 ? "The Image Stash is empty." : "No images match that search."}</p>
                            <p className="text-sm text-gray-500 mt-2">
                                {assets.length === 0
                                    ? "Upload an image from Alumni or the Image Stash page first."
                                    : "Try a different filename or clear the search."}
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {filtered.map(asset => {
                                const selected = selectedUrl === asset.url;
                                return (
                                    <button
                                        key={asset.id}
                                        type="button"
                                        onClick={() => { onSelect(asset); onClose(); }}
                                        aria-pressed={selected}
                                        className={`group text-left rounded-xl overflow-hidden border bg-white/5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${selected ? "border-blue-500 ring-2 ring-blue-500/30" : "border-white/10 hover:border-white/30"}`}
                                    >
                                        <div className="aspect-square bg-black/60 flex items-center justify-center overflow-hidden">
                                            <img
                                                src={asset.url}
                                                alt={asset.filename || "Stashed image"}
                                                loading="lazy"
                                                decoding="async"
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                        </div>
                                        <div className="p-2">
                                            <p className="text-xs text-gray-300 truncate" title={asset.filename}>{asset.filename || "image"}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="p-3 border-t border-white/10 text-xs text-gray-500 shrink-0">
                    {filtered.length} of {assets.length} {assets.length === 1 ? "image" : "images"}
                </div>
            </div>
        </div>
    );
}
