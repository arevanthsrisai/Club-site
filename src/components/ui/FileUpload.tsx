/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { uploadMedia } from "@/lib/mediaUpload";
import { FileText, Image as ImageIcon, UploadCloud } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface FileUploadProps {
    path: string;
    onUpload: (url: string) => void;
    currentUrl?: string;
    accept: string; // e.g. "image/*" or "application/pdf"
    label: string;
    type: "image" | "pdf";
}

export default function FileUpload({ path, onUpload, currentUrl, accept, label, type }: FileUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [preview, setPreview] = useState(currentUrl || "");
    const toast = useToast();

    const handleFile = async (file: File) => {
        if (!file) return;
        setUploading(true);
        setProgress(0);
        try {
            const { url } = await uploadMedia(file, path, (p) => setProgress(p));
            setPreview(url);
            onUpload(url);
        } catch (error) {
            console.error("Upload failed", error);
            toast.error(error instanceof Error ? error.message : "Failed to upload file");
        } finally {
            setUploading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    return (
        <div className="space-y-4">
            <label className="block text-sm font-bold text-gray-400 mb-2">{label}</label>

            <div className={`border-2 border-dashed border-white/10 rounded-xl p-6 text-center transition-colors hover:border-white/30 bg-black/20`}>

                {preview ? (
                    <div className="relative group mx-auto rounded-lg overflow-hidden mb-4">
                        {type === "image" ? (
                            <img src={preview} alt="Preview" className="h-32 mx-auto object-cover rounded-md" />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-32 bg-white/5 rounded-md text-red-400">
                                <FileText size={48} />
                                <p className="text-xs mt-2 text-gray-400 truncate max-w-[200px] px-2">PDF Uploaded</p>
                            </div>
                        )}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-md">
                            {/* Overlay only works well on image, for PDF just showing the button below is fine */}
                        </div>
                    </div>
                ) : (
                    <div className="text-gray-400 mb-4">
                        <UploadCloud size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm opacity-50">Upload {type === "image" ? "Image" : "PDF"}</p>
                    </div>
                )}

                <label className="cursor-pointer inline-block bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors text-sm">
                    <span>{uploading ? `Uploading ${Math.round(progress)}%...` : preview ? "Change File" : "Browse Files"}</span>
                    <input
                        type="file"
                        accept={accept}
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={uploading}
                    />
                </label>
            </div>

            {uploading && (
                <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
            )}
        </div>
    );
}
