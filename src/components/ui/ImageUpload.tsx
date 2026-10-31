import Image from "next/image";
import { useState } from "react";
import { uploadMedia } from "@/lib/mediaUpload";
import { useToast } from "@/components/ui/Toast";

interface ImageUploadProps {
    path: string;
    onUpload: (url: string) => void;
    currentImage?: string;
}

export default function ImageUpload({ path, onUpload, currentImage }: ImageUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState(currentImage || "");
    const [dragging, setDragging] = useState(false);
    const [progress, setProgress] = useState(0);
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
            toast.error(error instanceof Error ? error.message : "Failed to upload image");
        } finally {
            setUploading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("image/")) {
            handleFile(file);
        }
    };

    return (
        <div className="space-y-4">
            <label className="block text-sm font-bold text-gray-400 mb-2">Image</label>

            <div
                className={`border-2 border-dashed rounded-xl p-8 transition-colors text-center ${dragging ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/30"
                    }`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
            >
                {preview ? (
                    <div className="relative group w-48 h-32 mx-auto rounded-lg overflow-hidden">
                        <Image src={preview} alt="Preview" fill sizes="192px" className="object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <p className="text-white text-xs">Drag new image to replace</p>
                        </div>
                    </div>
                ) : (
                    <div className="text-gray-400">
                        <i className="fas fa-cloud-upload-alt text-3xl mb-3"></i>
                        <p className="text-sm">Drag & Drop Image Here</p>
                    </div>
                )}

                <label className="cursor-pointer mt-4 inline-block bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors text-sm">
                    <span>{uploading ? "Uploading..." : preview ? "Change Photo" : "Or Browse Files"}</span>
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={uploading}
                    />
                </label>
            </div>
            {uploading && (
                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mt-4">
                    <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
            {uploading && <p className="text-xs text-blue-400 text-center mt-2">Uploading... {Math.round(progress)}%</p>}
        </div>
    );
}
