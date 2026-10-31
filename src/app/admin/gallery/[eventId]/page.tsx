"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { getEvents, getEventGallery, addToGallery, deleteFromGallery, logActivity, GalleryImage } from "@/lib/api";
import { uploadGalleryMedia, checkStorageConfigured, isVideoProcessingOutcome, type UploadOutcome } from "@/lib/galleryUpload";
import { Event } from "@/types";
import { ArrowLeft, Trash2, Upload, Play, Image as ImageIcon, CloudOff, Sparkles, Loader2, CloudUpload, X, RotateCcw, AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Image from "next/image";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";

// Gallery upload hard limit — kept in sync with src/lib/objectStorage.ts (server re-validates).
const MAX_GALLERY_MB = 25;
const MAX_CONCURRENT_UPLOADS = 3;

export default function EventGalleryManager() {
    const params = useParams();
    const eventId = params.eventId as string;
    const { profile } = useAuth();
    const toast = useToast();

    const [event, setEvent] = useState<Event | null>(null);
    const [gallery, setGallery] = useState<GalleryImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [storageConfigured, setStorageConfigured] = useState<boolean | null>(null); // null = still checking
    const [missingKeys, setMissingKeys] = useState<string[]>([]);

    type QueueItem = {
        id: string;
        file: File;
        kind: "image" | "video";
        previewUrl: string;
        status: "queued" | "uploading" | "saving" | "completed" | "failed";
        progress: number;
        error?: string;
        outcome?: UploadOutcome;
        controller?: AbortController;
    };
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [dragging, setDragging] = useState(false);
    const [batchPaused, setBatchPaused] = useState(false);
    // Values the scheduler needs that must not restart the scheduler effect:
    const pausedRef = useRef(false);
    useEffect(() => {
        pausedRef.current = batchPaused;
    }, [batchPaused]);

    const loadData = useCallback(async () => {
        if (!eventId) return;
        try {
            const allEvents = await getEvents();
            const found = allEvents.find(e => e.id === eventId);
            setEvent(found || null);
            const media = await getEventGallery(eventId);
            setGallery(media);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [eventId]);

    useEffect(() => {
        loadData();
        checkStorageConfigured()
            .then(res => {
                setStorageConfigured(!!res.storageConfigured);
                setMissingKeys(res.missingKeys || []);
            })
            .catch(() => setStorageConfigured(false));
    }, [eventId, loadData]);

    // Revoke every preview object URL when the page unmounts.
    useEffect(() => {
        return () => {
            setQueue(items => {
                items.forEach(i => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
                return items;
            });
        };
    }, []);

    /** Client-side kind detection is a UX hint only; the server sniffs magic bytes. */
    const detectKind = (file: File): "image" | "video" | null => {
        if (file.type.startsWith("image/")) return "image";
        if (file.type.startsWith("video/")) return "video";
        if (/\.(jpe?g|png|gif|webp|avif)$/i.test(file.name)) return "image";
        if (/\.(mp4|webm|mov|m4v)$/i.test(file.name)) return "video";
        return null;
    };

    const enqueueFiles = (files: FileList | File[]) => {
        const items: QueueItem[] = [];
        for (const file of Array.from(files)) {
            const kind = detectKind(file);
            if (!kind) {
                toast.warning(`"${file.name}" is not an image or a video — skipped.`);
                continue;
            }
            if (file.size > MAX_GALLERY_MB * 1024 * 1024) {
                toast.warning(`"${file.name}" is larger than ${MAX_GALLERY_MB} MB — skipped.`);
                continue;
            }
            if (file.size === 0) {
                toast.warning(`"${file.name}" is empty — skipped.`);
                continue;
            }
            // Cross-queue duplicate protection: same name+size already queued or recently completed.
            if (queue.some(q => q.file.name === file.name && q.file.size === file.size && q.status !== "failed")) {
                toast.info(`"${file.name}" is already in the queue.`);
                continue;
            }
            items.push({
                id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                file,
                kind,
                previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
                status: "queued",
                progress: 0,
            });
        }
        if (items.length) setQueue(q => [...q, ...items]);
    };

    const removeFromQueue = (id: string) =>
        setQueue(q => q.filter(item => {
            if (item.id !== id) return true;
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
            if (item.status === "uploading" || item.status === "saving") {
                item.controller?.abort();
            }
            return false;
        }));

    const clearFinished = () =>
        setQueue(q => q.filter(item => {
            if (item.status === "completed") {
                if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
                return false;
            }
            return true;
        }));

    const retryItem = (id: string) => setQueue(q => q.map(item => item.id === id ? { ...item, status: "queued", progress: 0, error: undefined, controller: undefined } : item));

    const patchItem = (id: string, patch: Partial<QueueItem>) =>
        setQueue(q => q.map(item => item.id === id ? { ...item, ...patch } : item));

    // ------------------------------ scheduler ------------------------------
    // Bounded concurrency; queued items start in order while slots are free.
    const processing = queue.filter(i => i.status === "uploading" || i.status === "saving").length;
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const toStart: QueueItem[] = queue.filter(i => i.status === "queued").slice(0, Math.max(0, MAX_CONCURRENT_UPLOADS - processing));
            for (const item of toStart) {
                if (cancelled || pausedRef.current) return;
                patchItem(item.id, { status: "uploading", progress: 0 });
                runUpload(item.id, item.file, item.kind);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue, processing]);

    const runUpload = async (id: string, file: File, kind: "image" | "video") => {
        if (!event) return;
        const controller = new AbortController();
        patchItem(id, { controller });
        try {
            // 1) bytes → B2 via the admin-token route; progress = transfer.
            const outcome = await uploadGalleryMedia(file, event.id, pct => patchItem(id, { progress: pct }));

            // 2) metadata → Firestore; "saving" until the doc write lands.
            patchItem(id, { status: "saving", progress: 100 });
            if (outcome.processingStatus === "partial") {
                toast.warning(`${file.name}: stored, but ${outcome.processingError ?? "processing was incomplete"}.`);
            }
            await addToGallery({
                src: outcome.url,
                alt: `${event.title} - ${kind}`,
                eventId: event.id,
                type: kind,
                category: "event",
                storageKey: outcome.key,
                storedSize: outcome.storedSize,
                ...(isVideoProcessingOutcome(outcome) && {
                    thumbnailKey: outcome.thumbnailKey,
                    originalKey: outcome.originalKey,
                    processingStatus: outcome.processingStatus,
                    ...(outcome.processingError ? { processingError: outcome.processingError } : {}),
                }),
            });
            await logActivity(profile?.uid!, profile?.displayName || "Admin", `Uploaded ${kind} to gallery: ${event.title}`);
            patchItem(id, { status: "completed", outcome });
            loadData(); // keep gallery list fresh per completion
        } catch (error) {
            const message = error instanceof Error ? error.message : "Upload failed.";
            // When the server has no object storage configured the upload would
            // nowhere to go by design: stop the whole batch with a clear reason
            // instead of silently landing media in some other provider.
            if (/object storage is not configured/i.test(message)) {
                setBatchPaused(true);
                setStorageConfigured(false);
                clearQueueToFailed(message);
            }
            patchItem(id, { status: "failed", error: message });
        }
    };

    const clearQueueToFailed = (message: string) =>
        setQueue(q => q.map(item => item.status === "queued" ? { ...item, status: "failed", error: message, controller: undefined } : item));

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this item permanently? The stored file will be removed as well.")) return;
        try {
            await deleteFromGallery(id);
            if (event) {
                await logActivity(profile?.uid!, profile?.displayName || "Admin", `Deleted image from gallery: ${event.title}`);
            }
            loadData();
            toast.success("Gallery item deleted.");
        } catch (error) {
            console.error(error);
            toast.error("Could not delete this item. The storage service may be unavailable.");
        }
    };

    const inFlight = queue.some(i => i.status === "uploading" || i.status === "saving");
    const overall = useMemo(() => {
        const active = queue.filter(i => i.status !== "completed");
        if (active.length === 0) return queue.length ? 100 : 0;
        const total = active.reduce((sum, i) => sum + (i.status === "completed" ? 100 : i.progress || 0), 0);
        return Math.round(total / active.length);
    }, [queue]);

    if (loading) return <div className="p-8 flex items-center gap-3 text-gray-400"><Loader2 className="animate-spin" size={20} /> Loading gallery…</div>;
    if (!event) return (
        <div className="max-w-2xl mx-auto text-center py-24 bg-white/5 rounded-2xl border border-white/10">
            <ImageIcon size={40} className="mx-auto text-gray-600 mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">Event not found</h1>
            <p className="text-gray-400 text-sm mb-6">This gallery link points to an event that no longer exists.</p>
            <Link href="/admin/gallery" className="text-blue-400 hover:text-blue-300 text-sm font-medium">Back to all galleries</Link>
        </div>
    );

    const uploadBlocked = storageConfigured === false;

    return (
        <div className="max-w-6xl mx-auto text-white">
            <Link href="/admin/gallery" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
                <ArrowLeft size={18} /> Back to Events
            </Link>

            <PageHeader
                title={`Gallery · ${event.title}`}
                subtitle={`${gallery.length} item${gallery.length === 1 ? "" : "s"} · opened per event`}
                icon={<ImageIcon size={26} />}
            />

            {/* Object-store Status Banner */}
            {uploadBlocked && (
                <div className="mb-8 p-4 bg-yellow-500/10 border border-yellow-500/25 rounded-xl flex items-start gap-3 text-sm text-yellow-200/90" role="alert">
                    <CloudOff size={18} className="mt-0.5 shrink-0 text-yellow-400" />
                    <div>
                        <p className="font-semibold text-yellow-300 mb-1">Backblaze B2 object storage is not configured</p>
                        <p>Uploads are disabled rather than silently stored elsewhere. To restore uploads, set {missingKeys.length ? missingKeys.join(", ") : "B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY"} on the server and restart.</p>
                    </div>
                </div>
            )}

            {/* Upload Area */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-10">
                <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                    <Upload size={18} className="text-blue-400" /> Upload Media
                </h2>
                <p className="text-xs text-gray-500 mb-5 flex items-center gap-1.5">
                    <Sparkles size={12} className={uploadBlocked ? "text-gray-500" : "text-blue-400"} />
                    {uploadBlocked
                        ? "Uploads unavailable — storage is not configured"
                        : "Select many files at once, or drop them below · images & videos mixed · lossless compression for PNGs · videos normalized to H.264 MP4 with a poster thumbnail"}
                </p>

                {/* Drop zone */}
                <div
                    role="button"
                    tabIndex={uploadBlocked ? -1 : 0}
                    aria-disabled={uploadBlocked}
                    aria-label="Drop images or videos here, or press Enter to browse"
                    onClick={() => !uploadBlocked && document.getElementById("bulk-gallery-file")?.click()}
                    onKeyDown={(e) => { if (!uploadBlocked && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); document.getElementById("bulk-gallery-file")?.click(); } }}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        if (uploadBlocked) return;
                        if (e.dataTransfer.files?.length) enqueueFiles(e.dataTransfer.files);
                    }}
                    className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors cursor-pointer ${
                        dragging ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-blue-500/40 hover:bg-white/5"
                    } ${uploadBlocked ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                    <CloudUpload size={32} className="mx-auto mb-3 text-gray-500" aria-hidden="true" />
                    <p className="text-gray-300 font-medium">Drag &amp; drop images and videos here</p>
                    <p className="text-xs text-gray-500 mt-1">or click to browse — hold Ctrl/Shift to select many. Max {MAX_GALLERY_MB} MB each.</p>
                </div>
                <input
                    id="bulk-gallery-file"
                    type="file"
                    multiple
                    accept="image/*,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.jpg,.jpeg,.png,.gif,.webp,.avif"
                    className="sr-only"
                    onChange={(e) => {
                        if (e.target.files?.length) enqueueFiles(e.target.files);
                        e.target.value = ""; // allow re-adding the same file later
                    }}
                    disabled={uploadBlocked}
                />

                {/* Queue */}
                {queue.length > 0 && (
                    <div className="mt-5" role="region" aria-label="Upload queue">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                                    Queue · {queue.filter(i => i.status === "completed").length}/{queue.length} done
                                </span>
                                {inFlight && !batchPaused && (
                                    <span className="flex items-center gap-1.5 text-xs text-blue-400">
                                        <Loader2 size={12} className="animate-spin" /> Uploading {overall}%
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {inFlight && (
                                    <button type="button" onClick={() => setBatchPaused(p => !p)} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                                        {batchPaused ? "Resume" : "Pause"}
                                    </button>
                                )}
                                {queue.some(i => i.status === "completed") && (
                                    <button type="button" onClick={clearFinished} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">Clear finished</button>
                                )}
                            </div>
                        </div>

                        {/* Overall progress bar */}
                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-3" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100}>
                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${overall}%` }} />
                        </div>

                        <ul className="space-y-2">
                            {queue.map(item => (
                                <li key={item.id} className="p-3 bg-black/30 border border-white/10 rounded-lg flex items-center gap-3">
                                    {/* Preview */}
                                    <div className="w-14 h-10 rounded-md overflow-hidden bg-black/60 shrink-0 flex items-center justify-center" aria-hidden="true">
                                        {item.kind === "image" && item.previewUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                                        ) : item.kind === "video" ? (
                                            <video src={URL.createObjectURL(item.file)} muted className="w-full h-full object-cover" preload="metadata" />
                                        ) : (
                                            <ImageIcon size={14} />
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm text-gray-200 truncate">{item.file.name}</p>
                                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/10 text-gray-400 shrink-0">{item.kind}</span>
                                            <span className="text-[10px] text-gray-500 shrink-0">{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
                                        </div>
                                        {item.status === "failed" ? (
                                            <p className="text-xs text-red-400 mt-1 flex items-center gap-1.5"><AlertCircle size={11} className="shrink-0" /> {item.error}</p>
                                        ) : item.status === "completed" ? (
                                            <p className="text-xs text-green-400 mt-1 flex items-center gap-1.5"><CheckCircle2 size={11} className="shrink-0" /> Uploaded{item.outcome?.processingStatus === "partial" ? " — processing incomplete" : " to Backblaze B2"}</p>
                                        ) : (
                                            <div className="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-300 ${item.status === "saving" ? "bg-purple-500" : "bg-blue-500"}`}
                                                    style={{ width: `${item.status === "saving" ? 100 : item.progress}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        {item.status === "failed" && (
                                            <button type="button" onClick={() => retryItem(item.id)} title="Retry upload" aria-label={`Retry ${item.file.name}`} className="p-2 text-gray-400 hover:text-blue-400 rounded-lg hover:bg-white/5 transition-colors">
                                                <RotateCcw size={15} />
                                            </button>
                                        )}
                                        {(item.status === "queued" || item.status === "failed") && (
                                            <button type="button" onClick={() => removeFromQueue(item.id)} title="Remove from queue" aria-label={`Remove ${item.file.name} from queue`} className="p-2 text-gray-500 hover:text-red-500 rounded-lg hover:bg-white/5 transition-colors">
                                                <X size={15} />
                                            </button>
                                        )}
                                        {(item.status === "saving" || item.status === "uploading") && (
                                            <span className="flex items-center gap-1 text-xs text-gray-500 pr-2">
                                                <Loader2 size={12} className="animate-spin" /> {item.status === "saving" ? "Saving…" : "Uploading…"}
                                            </span>
                                        )}
                                        {item.status === "completed" && <CheckCircle2 size={15} className="text-green-500" />}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Gallery Grid */}
            {gallery.length > 0 ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {gallery.map((media) => (
                        <figure key={media.id} className="relative group bg-white/5 rounded-xl overflow-hidden border border-white/10 aspect-square">
                            {media.type === 'video' ? (
                                media.thumbnailKey || media.src?.includes("key=") ? (
                                    <div className="w-full h-full bg-black/60 relative">
                                        {media.thumbnailKey ? (
                                            <Image src={`/api/gallery/media?key=${encodeURIComponent(media.thumbnailKey)}`} alt={media.alt || "Video poster"} fill className="object-cover" sizes="(max-width: 1024px) 50vw, 25vw" />
                                        ) : (
                                            <div className="p-2 opacity-50">
                                                <video src={media.src} className="w-full h-full object-cover" preload="metadata" aria-hidden="true" />
                                            </div>
                                        )}
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Play size={30} className="text-white/70 drop-shadow" aria-hidden="true" />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-black/60">
                                        <Play size={32} className="text-white/60" />
                                    </div>
                                )
                            ) : (
                                <Image src={media.src} alt={media.alt || "Gallery image"} fill sizes="(max-width: 1024px) 50vw, 25vw" className="object-cover" />
                            )}

                            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                <button
                                    onClick={() => handleDelete(media.id)}
                                    className="p-2.5 bg-red-600 rounded-full hover:bg-red-500 text-white transition-transform hover:scale-110"
                                    title="Delete item"
                                    aria-label={`Delete: ${media.alt || "gallery item"}`}
                                >
                                    <Trash2 size={16} />
                                </button>
                                <a
                                    href={media.type === "video" ? getVideoHref(media) : media.src}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2.5 bg-blue-600 rounded-full hover:bg-blue-500 text-white transition-transform hover:scale-110"
                                    title="View original"
                                    aria-label={`View original: ${media.alt || "gallery item"}`}
                                >
                                    <ImageIcon size={16} />
                                </a>
                            </div>
                        </figure>
                    ))}
                </div>
            ) : (
                <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
                    <ImageIcon size={36} className="mx-auto text-gray-600 mb-4" />
                    <p className="text-gray-400 font-medium">No media uploaded for this event yet.</p>
                    <p className="text-gray-600 text-sm mt-1">Photos and videos added here appear on the event&apos;s public page.</p>
                </div>
            )}
        </div>
    );
}

/** Videos open the raw object URL in a new tab; images use their stored src. */
function getVideoHref(media: GalleryImage): string {
    return media.src;
}
