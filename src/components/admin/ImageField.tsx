"use client";

/* eslint-disable @next/next/no-img-element */
import { useId, useRef, useState } from "react";
import { ImageIcon, Images, Loader2, Trash2, Upload, X } from "lucide-react";
import ImagePicker from "@/components/admin/ImagePicker";
import { assetIdFromUrl } from "@/lib/imageStash";
import { uploadStashImage } from "@/lib/imageStashClient";
import { useToast } from "@/components/ui/Toast";

interface ImageFieldProps {
    value: string;
    onChange: (url: string) => void;
    /** Called when a brand-new asset was created by this form (for rollback). */
    onCreateDraft?: (assetId: string) => void;
    /** Called to discard an asset created in this form (parent decides safety). */
    onDiscardDraft?: (assetId: string) => void;
    label?: string;
    helpText?: string;
    shape?: "avatar" | "cover";
}

/**
 * Image control for admin forms.
 *
 * Select a file (or drop it) and it uploads straight into the Image Stash; the
 * resulting stable `/api/images/{id}` URL is written into the form value. No
 * external upload, no pasted URL. Existing stash images can be reused with the
 * picker, and a direct URL stays available as an advanced fallback.
 */
export default function ImageField({
    value,
    onChange,
    onCreateDraft,
    onDiscardDraft,
    label = "Profile Image",
    helpText = "Upload a new image or reuse one from the Image Stash.",
    shape = "avatar",
}: ImageFieldProps) {
    const inputId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const { success, error } = useToast();

    const handleFile = async (file: File) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            error("Please choose an image file (jpg, png, gif, webp or avif).");
            return;
        }

        const previousDraft = assetIdFromUrl(value);
        setUploading(true);
        setProgress(0);
        try {
            const { asset, reused } = await uploadStashImage(file, setProgress);
            if (!reused) onCreateDraft?.(asset.id);
            if (previousDraft && previousDraft !== asset.id) onDiscardDraft?.(previousDraft);
            onChange(asset.url);
            success(reused ? "Used the identical image already in the stash." : "Image uploaded.");
        } catch (err) {
            error(err instanceof Error ? err.message : "Image upload failed.");
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const removeImage = () => {
        const id = assetIdFromUrl(value);
        if (id) onDiscardDraft?.(id);
        onChange("");
    };

    /** Replacing or retyping a value abandons a draft asset uploaded here. */
    const setFromStashOrManual = (next: string) => {
        const previousDraft = assetIdFromUrl(value);
        if (previousDraft && previousDraft !== assetIdFromUrl(next)) {
            onDiscardDraft?.(previousDraft);
        }
        onChange(next);
    };

    const previewClass = shape === "avatar"
        ? "w-24 h-24 rounded-full"
        : "w-full max-w-sm aspect-[4/3] rounded-xl";

    return (
        <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
                <span className="block text-sm text-gray-400">{label}</span>
                <span className="text-xs text-gray-500">Stored in the Image Stash</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className={`shrink-0 bg-black/40 border border-white/10 overflow-hidden flex items-center justify-center ${previewClass}`}>
                    {value ? (
                        <img src={value} alt="Selected image preview" className="w-full h-full object-cover" />
                    ) : (
                        <ImageIcon size={28} className="text-gray-600" aria-hidden="true" />
                    )}
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                    <div
                        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragging(false);
                            const file = event.dataTransfer.files?.[0];
                            if (file) void handleFile(file);
                        }}
                        className={`rounded-xl border border-dashed px-4 py-3 text-sm transition-colors ${dragging ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-white/15 text-gray-400"}`}
                    >
                        {uploading ? (
                            <div className="space-y-2">
                                <p className="flex items-center gap-2 text-blue-300">
                                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                                    Uploading… {progress}%
                                </p>
                                <progress
                                    className="w-full h-1.5 accent-blue-500"
                                    value={progress}
                                    max={100}
                                    aria-label="Image upload progress"
                                />
                            </div>
                        ) : (
                            <p>Drag an image here, or use the buttons below.</p>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <label
                            htmlFor={inputId}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${uploading ? "bg-white/5 text-gray-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white"}`}
                        >
                            <Upload size={15} aria-hidden="true" />
                            {value ? "Replace image" : "Upload image"}
                            <input
                                id={inputId}
                                ref={inputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                                className="sr-only"
                                disabled={uploading}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void handleFile(file);
                                }}
                            />
                        </label>

                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors"
                        >
                            <Images size={15} aria-hidden="true" />
                            Choose from stash
                        </button>

                        {value && (
                            <button
                                type="button"
                                onClick={removeImage}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors"
                            >
                                <Trash2 size={15} aria-hidden="true" />
                                Remove
                            </button>
                        )}
                    </div>

                    <p className="text-xs text-gray-500">{helpText}</p>

                    <details className="text-xs text-gray-500">
                        <summary className="cursor-pointer select-none hover:text-gray-300 transition-colors">
                            Use a direct image URL instead
                        </summary>
                        <div className="mt-2 flex gap-2">
                            <label htmlFor={`${inputId}-url`} className="sr-only">Direct image URL</label>
                            <input
                                id={`${inputId}-url`}
                                type="url"
                                value={value}
                                onChange={(event) => setFromStashOrManual(event.target.value)}
                                placeholder="https://…"
                                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
                            />
                            {value && (
                                <button
                                    type="button"
                                    onClick={removeImage}
                                    aria-label="Clear image URL"
                                    className="px-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </details>
                </div>
            </div>

            {pickerOpen && (
                <ImagePicker
                    selectedUrl={value}
                    onClose={() => setPickerOpen(false)}
                    onSelect={(asset) => setFromStashOrManual(asset.url)}
                />
            )}
        </div>
    );
}
