import { createHash } from "crypto";
import type { ServerAuthContext } from "@/lib/serverAuthz";
import { hasPermission } from "@/lib/serverAuthz";
import {
    MAX_GALLERY_UPLOAD_BYTES,
    extFor,
    losslesslyOptimize,
    sniffMedia,
} from "@/lib/objectStorage";

/**
 * Server-only helpers shared by the Image Stash API routes.
 *
 * Uploads are validated the same way as every other media upload: real bytes
 * are sniffed, the browser MIME type is ignored, and only images are accepted
 * into the stash (which is an image library, not a general file dump).
 */

/** Content managers may add images to the stash so they can use them in their own forms. */
export const STASH_UPLOAD_PERMISSIONS = [
    "gallery.manage",
    "alumni.manage",
    "excore.manage",
    "team.manage",
    "resources.manage",
    "events.manage",
] as const;

export function canUploadToStash(ctx: ServerAuthContext | null): boolean {
    return STASH_UPLOAD_PERMISSIONS.some(permission => hasPermission(ctx, permission));
}

/** Deleting shared assets is restricted to media managers; CTO always qualifies. */
export function canDeleteFromStash(ctx: ServerAuthContext | null): boolean {
    return hasPermission(ctx, "gallery.manage");
}

export class ImageUploadError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.name = "ImageUploadError";
        this.status = status;
    }
}

export interface ValidatedImageUpload {
    file: File;
    /** Original bytes, hashed for duplicate detection. */
    original: Buffer;
    /** Best bytes to store (losslessly shrunk when that helps). */
    optimized: { data: Buffer; contentType: string; ext: string };
    checksum: string;
}

/** Reads and validates the `file` field of a multipart request. */
export async function readImageUpload(request: Request): Promise<ValidatedImageUpload> {
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        throw new ImageUploadError("Expected a multipart form with an image file.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
        throw new ImageUploadError("No file provided.", 400);
    }
    if (file.size === 0) {
        throw new ImageUploadError("The selected file is empty.", 400);
    }
    if (file.size > MAX_GALLERY_UPLOAD_BYTES) {
        throw new ImageUploadError(
            `Image must be smaller than ${Math.round(MAX_GALLERY_UPLOAD_BYTES / 1024 / 1024)} MB.`,
            413,
        );
    }

    const original = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMedia(original, file.type);
    if (!sniffed) {
        throw new ImageUploadError("Unsupported file content (jpg/png/gif/webp/avif only).", 400);
    }
    if (sniffed.type !== "image") {
        throw new ImageUploadError("The Image Stash accepts images only.", 400);
    }

    const optimized = await losslesslyOptimize(original, sniffed.contentType);
    if (!optimized.ext) {
        optimized.ext = extFor(sniffed.contentType);
    }
    const checksum = createHash("sha256").update(original).digest("hex");

    return { file, original, optimized, checksum };
}
