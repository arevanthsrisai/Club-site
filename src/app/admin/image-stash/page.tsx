"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    AlertTriangle, Copy, Eye, Images, Loader2,
    RefreshCw, Search, Trash2, Upload, X,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { StoredImage } from "@/types";
import { subscribeToImageAssets } from "@/services/imageAssets";
import {
    ImageDateFilter,
    MAX_IMAGE_UPLOAD_BYTES,
    createdWithin,
    formatBytes,
    matchesImageSearch,
} from "@/lib/imageStash";
import {
    AssetInUseError,
    ImageReference,
    deleteStashImage,
    importAlumniImages,
    replaceStashImage,
    uploadStashImage,
} from "@/lib/imageStashClient";

interface UploadJob {
    key: string;
    name: string;
    progress: number;
    status: "uploading" | "done" | "error";
    message?: string;
}

interface BlockedDelete {
    asset: StoredImage;
    references: ImageReference[];
}

type ImageTypeFilter = "all" | "jpeg" | "png" | "webp" | "gif" | "avif" | "other";

function matchesType(asset: StoredImage, filter: ImageTypeFilter): boolean {
    if (filter === "all") return true;
    const contentType = asset.contentType || "";
    if (filter === "other") return !/^image\/(jpeg|png|webp|gif|avif)$/.test(contentType);
    return contentType === `image/${filter}`;
}

function absoluteUrl(path: string): string {
    if (typeof window === "undefined") return path;
    try {
        return new URL(path, window.location.origin).toString();
    } catch {
        return path;
    }
}

function formatDate(value: unknown): string {
    if (!value) return "—";
    const maybe = value as { toDate?: () => Date; seconds?: number };
    const date = typeof maybe.toDate === "function"
        ? maybe.toDate()
        : typeof maybe.seconds === "number"
            ? new Date(maybe.seconds * 1000)
            : new Date(value as string);
    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function ImageStashPage() {
    const [assets, setAssets] = useState<StoredImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [search, setSearch] = useState("");
    const [dateFilter, setDateFilter] = useState<ImageDateFilter>("all");
    const [typeFilter, setTypeFilter] = useState<ImageTypeFilter>("all");
    const [uploads, setUploads] = useState<UploadJob[]>([]);
    const [dragActive, setDragActive] = useState(false);
    const [preview, setPreview] = useState<StoredImage | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [replacingId, setReplacingId] = useState<string | null>(null);
    const [replaceProgress, setReplaceProgress] = useState(0);
    const [blocked, setBlocked] = useState<BlockedDelete | null>(null);
    const [importing, setImporting] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { success, error } = useToast();

    useEffect(() => {
        const unsubscribe = subscribeToImageAssets(
            (data) => {
                setAssets(data);
                setLoading(false);
                setLoadError("");
            },
            () => {
                setLoadError("Could not load the Image Stash. Check your connection and refresh.");
                setLoading(false);
            },
        );
        return () => unsubscribe();
    }, []);

    const filtered = useMemo(
        () => assets.filter(asset =>
            matchesImageSearch(asset, search)
            && createdWithin(dateFilter, asset.createdAt)
            && matchesType(asset, typeFilter)),
        [assets, search, dateFilter, typeFilter],
    );

    const uploadFiles = async (files: File[]) => {
        const images = files.filter(file => file.type.startsWith("image/"));
        if (images.length === 0) {
            error("Choose one or more image files (jpg, png, gif, webp or avif).");
            return;
        }
        const tooLarge = images.find(file => file.size > MAX_IMAGE_UPLOAD_BYTES);
        if (tooLarge) {
            error(`${tooLarge.name} is larger than 25 MB.`);
            return;
        }

        let succeeded = 0;
        let reused = 0;
        let failed = 0;

        for (const file of images) {
            const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
            setUploads(prev => [...prev, { key, name: file.name, progress: 0, status: "uploading" }]);
            try {
                const result = await uploadStashImage(file, (progress) => {
                    setUploads(prev => prev.map(job => job.key === key ? { ...job, progress } : job));
                });
                if (result.reused) reused += 1;
                else succeeded += 1;
                setUploads(prev => prev.map(job => job.key === key
                    ? { ...job, progress: 100, status: "done", message: result.reused ? "Already in stash" : "Uploaded" }
                    : job));
            } catch (err) {
                failed += 1;
                setUploads(prev => prev.map(job => job.key === key
                    ? { ...job, status: "error", message: err instanceof Error ? err.message : "Upload failed" }
                    : job));
            }
        }

        if (failed > 0) {
            error(`${failed} upload${failed === 1 ? "" : "s"} failed. See the list above.`);
        } else if (reused > 0 && succeeded === 0) {
            success("Those images were already in the stash — reused them.");
        } else {
            success(
                `${succeeded} image${succeeded === 1 ? "" : "s"} uploaded${reused ? `, ${reused} reused` : ""}.`,
            );
        }
    };

    const copyUrl = async (asset: StoredImage) => {
        const url = absoluteUrl(asset.url);
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                fallbackCopy(url);
            }
            setCopiedId(asset.id);
            window.setTimeout(() => setCopiedId(prev => prev === asset.id ? null : prev), 2000);
            success("Friendly URL copied to the clipboard.");
        } catch {
            try {
                fallbackCopy(url);
                setCopiedId(asset.id);
                success("Friendly URL copied to the clipboard.");
            } catch {
                setPreview(asset);
                error("Clipboard access was blocked. Copy the URL from the preview panel.");
            }
        }
    };

    const handleDelete = async (asset: StoredImage) => {
        const confirmed = confirm(`Delete "${asset.filename}" from the Image Stash? This cannot be undone.`);
        if (!confirmed) return;
        setDeletingId(asset.id);
        try {
            const result = await deleteStashImage(asset.id);
            success(result.message);
        } catch (err) {
            if (err instanceof AssetInUseError) {
                setBlocked({ asset, references: err.references });
            } else {
                error(err instanceof Error ? err.message : "Could not delete the image.");
            }
        } finally {
            setDeletingId(null);
        }
    };

    const handleReplace = async (asset: StoredImage, file: File) => {
        if (!file.type.startsWith("image/")) {
            error("Choose an image file to replace this asset.");
            return;
        }
        const confirmed = confirm(
            `Replace "${asset.filename}" everywhere it is used? Its friendly URL stays the same, so every profile showing this image will show the new one.`,
        );
        if (!confirmed) return;
        setReplacingId(asset.id);
        setReplaceProgress(0);
        try {
            const result = await replaceStashImage(asset.id, file, setReplaceProgress);
            success(result.message);
        } catch (err) {
            error(err instanceof Error ? err.message : "Could not replace the image.");
        } finally {
            setReplacingId(null);
        }
    };

    const handleImport = async () => {
        setImporting(true);
        try {
            const result = await importAlumniImages();
            success(
                result.imported > 0
                    ? `Indexed ${result.imported} alumni image${result.imported === 1 ? "" : "s"}.`
                    : "No new alumni images to index.",
            );
        } catch (err) {
            error(err instanceof Error ? err.message : "Import failed.");
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto text-white">
            <PageHeader
                title="Image Stash"
                subtitle="One library for every admin-managed image. Upload once, copy its friendly URL, reuse it anywhere."
                icon={<Images size={26} />}
                actions={
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-colors shadow-lg shadow-blue-500/20"
                    >
                        <Upload size={18} />
                        Upload images
                    </button>
                }
            />

            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                multiple
                className="sr-only"
                aria-label="Upload images to the Image Stash"
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length) void uploadFiles(files);
                }}
            />

            {/* Drop zone */}
            <div
                onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    void uploadFiles(Array.from(event.dataTransfer.files ?? []));
                }}
                className={`rounded-2xl border border-dashed p-5 mb-6 transition-colors ${dragActive ? "border-blue-500 bg-blue-500/10" : "border-white/15 bg-white/[0.03]"}`}
            >
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-sm text-gray-400">
                        <Upload size={18} className="text-blue-400" aria-hidden="true" />
                        <span>Drop images here to upload them to the stash. You can select several at once.</span>
                    </div>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        Browse files
                    </button>
                </div>

                {uploads.length > 0 && (
                    <div className="mt-4 space-y-2">
                        {uploads.map(job => (
                            <div key={job.key} className="flex flex-wrap items-center gap-3 text-xs">
                                <span className="text-gray-300 truncate max-w-[14rem]" title={job.name}>{job.name}</span>
                                {job.status === "uploading" ? (
                                    <progress
                                        className="flex-1 min-w-[8rem] h-1.5 accent-blue-500"
                                        value={job.progress}
                                        max={100}
                                        aria-label={`Uploading ${job.name}: ${job.progress}%`}
                                    />
                                ) : null}
                                <span className={job.status === "error" ? "text-red-400" : job.status === "done" ? "text-green-400" : "text-blue-300"}>
                                    {job.message ?? `${job.progress}%`}
                                </span>
                            </div>
                        ))}
                        {uploads.every(job => job.status !== "uploading") && (
                            <button
                                onClick={() => setUploads([])}
                                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                            >
                                Clear upload list
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
                <div className="relative flex-1">
                    <label htmlFor="image-stash-search" className="sr-only">Search images</label>
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                    <input
                        id="image-stash-search"
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by filename or friendly URL…"
                        className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>
                <div>
                    <label htmlFor="image-stash-date" className="sr-only">Filter by upload date</label>
                    <select
                        id="image-stash-date"
                        value={dateFilter}
                        onChange={(event) => setDateFilter(event.target.value as ImageDateFilter)}
                        className="w-full sm:w-auto bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                    >
                        <option value="all">All uploads</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="image-stash-type" className="sr-only">Filter by file type</label>
                    <select
                        id="image-stash-type"
                        value={typeFilter}
                        onChange={(event) => setTypeFilter(event.target.value as ImageTypeFilter)}
                        className="w-full sm:w-auto bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                    >
                        <option value="all">All types</option>
                        <option value="jpeg">JPEG</option>
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                        <option value="gif">GIF</option>
                        <option value="avif">AVIF</option>
                        <option value="other">Other / indexed</option>
                    </select>
                </div>
                <button
                    onClick={handleImport}
                    disabled={importing}
                    title="Index photos already used on alumni profiles so they can be reused here"
                    className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-gray-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                    {importing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {importing ? "Indexing…" : "Index alumni photos"}
                </button>
                <p className="text-xs text-gray-500 whitespace-nowrap" aria-live="polite">
                    {filtered.length} of {assets.length} {assets.length === 1 ? "image" : "images"}
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-24 text-gray-400">
                    <Loader2 className="animate-spin text-blue-500" size={28} aria-hidden="true" />
                    <span className="ml-3 text-sm">Loading the Image Stash…</span>
                </div>
            ) : loadError ? (
                <p role="alert" className="text-center text-red-400 py-16">{loadError}</p>
            ) : assets.length === 0 ? (
                <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/10">
                    <Images size={48} className="mx-auto text-gray-600 mb-4" aria-hidden="true" />
                    <p className="text-xl text-gray-300">The stash is empty.</p>
                    <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                        Upload your first image above. It becomes available in the alumni form and anywhere else an
                        admin image is needed.
                    </p>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-colors"
                    >
                        <Upload size={17} /> Upload an image
                    </button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/10">
                    <Search size={40} className="mx-auto text-gray-600 mb-3" aria-hidden="true" />
                    <p className="text-gray-300">No images match this search.</p>
                    <button
                        onClick={() => { setSearch(""); setDateFilter("all"); setTypeFilter("all"); }}
                        className="mt-4 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        Clear filters
                    </button>
                </div>
            ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(asset => (
                        <li key={asset.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden flex flex-col">
                            <div className="relative aspect-[4/3] bg-black/50 group">
                                <img
                                    src={asset.url}
                                    alt={asset.filename || "Stashed image"}
                                    loading="lazy"
                                    decoding="async"
                                    className="w-full h-full object-cover"
                                />
                                <button
                                    onClick={() => setPreview(asset)}
                                    aria-label={`Preview ${asset.filename}`}
                                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-white"
                                >
                                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                                        <Eye size={18} /> Preview
                                    </span>
                                </button>
                                {asset.source === "imported" && (
                                    <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide bg-black/70 border border-white/15 rounded px-1.5 py-0.5 text-gray-300">
                                        Indexed
                                    </span>
                                )}
                                {replacingId === asset.id && (
                                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 p-4">
                                        <Loader2 size={20} className="animate-spin text-blue-400" aria-hidden="true" />
                                        <progress
                                            className="w-full h-1.5 accent-blue-500"
                                            value={replaceProgress}
                                            max={100}
                                            aria-label={`Replacing ${asset.filename}: ${replaceProgress}%`}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="p-4 flex flex-col gap-3 flex-1">
                                <div className="min-w-0">
                                    <p className="font-semibold text-sm truncate" title={asset.filename}>{asset.filename || "image"}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {formatBytes(asset.size)} · {formatDate(asset.createdAt)}
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5">
                                    <code className="text-[11px] text-gray-400 truncate flex-1" title={asset.url}>{asset.url}</code>
                                    <button
                                        onClick={() => void copyUrl(asset)}
                                        aria-label={`Copy friendly URL for ${asset.filename}`}
                                        className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors shrink-0"
                                    >
                                        <Copy size={13} />
                                    </button>
                                    {copiedId === asset.id && <span className="text-[10px] text-green-400 shrink-0">Copied</span>}
                                </div>

                                <div className="flex items-center justify-between gap-2 mt-auto">
                                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-blue-400 cursor-pointer transition-colors">
                                        <RefreshCw size={13} aria-hidden="true" /> Replace
                                        <input
                                            type="file"
                                            accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                                            className="sr-only"
                                            aria-label={`Replace ${asset.filename}`}
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                event.target.value = "";
                                                if (file) void handleReplace(asset, file);
                                            }}
                                        />
                                    </label>

                                    <button
                                        onClick={() => void copyUrl(asset)}
                                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
                                    >
                                        <Copy size={13} aria-hidden="true" /> Copy URL
                                    </button>

                                    <button
                                        onClick={() => void handleDelete(asset)}
                                        disabled={deletingId === asset.id}
                                        aria-label={`Delete ${asset.filename}`}
                                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                                    >
                                        {deletingId === asset.id
                                            ? <Loader2 size={13} className="animate-spin" />
                                            : <Trash2 size={13} />}
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <p className="mt-8 text-xs text-gray-500">
                Need an image on an alumni profile? Use{" "}
                <Link href="/admin/alumni" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
                    Alumni Management
                </Link>{" "}
                — uploads there land in this same stash automatically.
            </p>

            {preview && (
                <div
                    className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="image-preview-title"
                    onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }}
                >
                    <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="flex items-center justify-between gap-4 p-4 border-b border-white/10">
                            <h2 id="image-preview-title" className="font-bold truncate">{preview.filename || "Image"}</h2>
                            <button
                                onClick={() => setPreview(null)}
                                aria-label="Close preview"
                                className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4 bg-black/60 flex items-center justify-center">
                            <img src={preview.url} alt={preview.filename || "Stashed image"} className="max-h-[60vh] w-auto object-contain rounded-lg" />
                        </div>
                        <div className="p-4 space-y-3 text-sm">
                            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <div>
                                    <dt className="text-gray-500">Size</dt>
                                    <dd className="text-gray-300 mt-0.5">{formatBytes(preview.size)}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Type</dt>
                                    <dd className="text-gray-300 mt-0.5 truncate">{preview.contentType || "—"}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Uploaded</dt>
                                    <dd className="text-gray-300 mt-0.5">{formatDate(preview.createdAt)}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Revision</dt>
                                    <dd className="text-gray-300 mt-0.5">{preview.revision ?? 1}</dd>
                                </div>
                            </dl>
                            {preview.provider === "external" && (
                                <p className="text-xs text-amber-300/90 flex items-start gap-2">
                                    <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                                    Indexed from existing content; the file itself lives on another provider.
                                </p>
                            )}
                            <div>
                                <label htmlFor="image-preview-url" className="block text-xs text-gray-500 mb-1">Friendly URL</label>
                                <div className="flex gap-2">
                                    <input
                                        id="image-preview-url"
                                        readOnly
                                        value={absoluteUrl(preview.url)}
                                        onFocus={(event) => event.currentTarget.select()}
                                        className="flex-1 min-w-0 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300"
                                    />
                                    <button
                                        onClick={() => void copyUrl(preview)}
                                        className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold transition-colors"
                                    >
                                        <Copy size={13} /> Copy
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {blocked && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="image-in-use-title"
                    onClick={(event) => { if (event.target === event.currentTarget) setBlocked(null); }}
                >
                    <div className="bg-[#111] border border-amber-500/30 rounded-2xl w-full max-w-lg shadow-2xl">
                        <div className="p-5 border-b border-white/10 flex items-start gap-3">
                            <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={20} aria-hidden="true" />
                            <div className="min-w-0">
                                <h2 id="image-in-use-title" className="font-bold text-white">This image is still in use</h2>
                                <p className="text-sm text-gray-400 mt-1">
                                    Deleting it now would break the content below. Replace the image there first,
                                    then delete it here.
                                </p>
                            </div>
                        </div>
                        <ul className="p-5 space-y-2 max-h-64 overflow-y-auto">
                            {blocked.references.map((reference, index) => (
                                <li key={`${reference.collection}-${reference.id}-${index}`} className="text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                                    <span className="text-gray-200">{reference.label}</span>
                                    <span className="block text-xs text-gray-500 mt-0.5">
                                        {reference.collection}{reference.field ? ` · ${reference.field}` : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="p-4 border-t border-white/10 flex justify-between items-center gap-3">
                            {blocked.references.some(reference => reference.collection === "alumni") ? (
                                <Link href="/admin/alumni" className="text-xs text-blue-400 hover:text-blue-300">
                                    Open Alumni Management
                                </Link>
                            ) : <span />}
                            <button
                                onClick={() => setBlocked(null)}
                                className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm font-semibold transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function fallbackCopy(text: string) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) throw new Error("Copy failed");
}
