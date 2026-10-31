"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { X, Loader2, Check } from "lucide-react";

interface AvatarSelectorProps {
    currentAvatar?: string;
    onSelect: (url: string) => void;
    onClose: () => void;
}

export default function AvatarSelector({ currentAvatar, onSelect, onClose }: AvatarSelectorProps) {
    const [avatarsMap, setAvatarsMap] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState<string>("");
    const [selectedAvatar, setSelectedAvatar] = useState(currentAvatar || "");
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const fetchAvatars = async () => {
            try {
                const res = await fetch('/api/avatars');
                if (res.ok) {
                    const data = await res.json();
                    setAvatarsMap(data);
                    const categories = Object.keys(data);
                    if (categories.length > 0) {
                        // Try to find category of current avatar, else default to first
                        let initialCategory = categories[0];
                        if (currentAvatar) {
                            // URL format: /avatars/category/file.png
                            const parts = currentAvatar.split('/');
                            if (parts.length > 3) {
                                const cat = parts[2];
                                if (categories.includes(cat)) {
                                    initialCategory = cat;
                                }
                            }
                        }
                        setActiveCategory(initialCategory);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch avatars", error);
            } finally {
                setLoading(false);
            }
        };
        fetchAvatars();
    }, [currentAvatar]);

    const handleSelect = (url: string) => {
        setSelectedAvatar(url);
        onSelect(url);
        onClose();
    };

    const categories = Object.keys(avatarsMap);

    // Escape closes the dialog; focus lands on the close button for keyboard users.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        closeRef.current?.focus();
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="Select avatar"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">

                {/* Header */}
                <div className="p-4 border-b border-white/10 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-white">Select Avatar</h2>
                        <p className="text-sm text-gray-400">Choose your cybernetic identity</p>
                    </div>
                    <button ref={closeRef} onClick={onClose} aria-label="Close avatar selector" className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex-grow flex items-center justify-center min-h-[300px]">
                        <Loader2 className="animate-spin text-blue-500" size={32} />
                    </div>
                ) : (
                    <div className="flex flex-col md:flex-row flex-grow overflow-hidden h-[60vh] md:h-[70vh]">

                        {/* Sidebar / Tabs (Desktop: Left, Mobile: Top) */}
                        <div className="w-full md:w-48 border-b md:border-b-0 md:border-r border-white/10 shrink-0 overflow-x-auto md:overflow-y-auto bg-black/20 p-2 flex md:flex-col gap-1 md:gap-2 custom-scrollbar">
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setActiveCategory(cat)}
                                    className={`px-4 py-3 rounded-lg text-sm font-bold capitalize whitespace-nowrap text-left transition-all flex items-center gap-2 ${activeCategory === cat
                                        ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                                        }`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${activeCategory === cat ? 'bg-blue-500' : 'bg-gray-600'}`} />
                                    {cat}
                                </button>
                            ))}
                        </div>

                        {/* Grid */}
                        <div className="flex-grow overflow-y-auto p-4 md:p-6 bg-[#0a0a0a] custom-scrollbar">
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 md:gap-4">
                                {avatarsMap[activeCategory]?.map((url) => (
                                    <button
                                        key={url}
                                        onClick={() => handleSelect(url)}
                                        className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition-all duration-200 ${selectedAvatar === url
                                            ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)] scale-95 ring-2 ring-blue-500/20'
                                            : 'border-white/5 hover:border-white/30 hover:scale-[1.02] hover:shadow-lg'
                                            }`}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

                                        <Image
                                            src={url}
                                            alt="Avatar"
                                            fill
                                            className="object-cover transition-transform duration-500 group-hover:scale-110"
                                            sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 15vw"
                                        />

                                        {selectedAvatar === url && (
                                            <div className="absolute inset-0 bg-blue-500/30 flex items-center justify-center z-20 backdrop-blur-[1px]">
                                                <div className="bg-blue-500 rounded-full p-1.5 shadow-lg transform scale-100 animate-in zoom-in duration-200">
                                                    <Check className="text-white" size={20} />
                                                </div>
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
