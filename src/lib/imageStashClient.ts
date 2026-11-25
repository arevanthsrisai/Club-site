"use client";

import type { StoredImage } from "@/types";
import { getAuthToken } from "@/lib/authHeaders";

/**
 * Browser helpers for the admin Image Stash.
 *
 * All writes go through token-verified server routes; B2 credentials never
 * reach the browser. Uploads use XHR so real progress can be shown.
 */

export interface ImageReference {
    collection: string;
    field: string;
    id: string;
    label: string;
}

export class AssetInUseError extends Error {
    references: ImageReference[];
    constructor(message: string, references: ImageReference[]) {
        super(message);
        this.name = "AssetInUseError";
        this.references = references;
    }
}

export interface UploadAssetResult {
    id: string;
    url: string;
    key?: string | null;
    filename: string;
    contentType?: string;
    size?: number;
    checksum?: string;
}

export interface ReplaceAssetResult extends UploadAssetResult {
    message: string;
}

async function authOrThrow(): Promise<string> {
    const token = await getAuthToken();
    if (!token) throw new Error("Not signed in — sign in again to manage images.");
    return token;
}

function parseJson(text: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(text || "{}");
        return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function uploadWithProgress(
    url: string,
    file: File,
    onProgress?: (pct: number) => void,
): Promise<{ status: number; json: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append("file", file);

        xhr.open("POST", url);
        authOrThrow().then(token => {
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            if (onProgress) {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        onProgress(Math.round((event.loaded / event.total) * 100));
                    }
                };
            }
            xhr.onload = () => resolve({ status: xhr.status, json: parseJson(xhr.responseText) });
            xhr.onerror = () => reject(new Error("Upload failed — network error."));
            xhr.send(form);
        }).catch(reject);
    });
}

function assetFromResponse(json: Record<string, unknown>): UploadAssetResult {
    const asset = json.asset;
    if (!asset || typeof asset !== "object") {
        throw new Error("Upload succeeded but the server returned no asset.");
    }
    const a = asset as Record<string, unknown>;
    if (typeof a.id !== "string" || typeof a.url !== "string") {
        throw new Error("Upload succeeded but the asset is incomplete.");
    }
    return {
        id: a.id,
        url: a.url,
        key: typeof a.key === "string" ? a.key : null,
        filename: typeof a.filename === "string" ? a.filename : "image",
        contentType: typeof a.contentType === "string" ? a.contentType : undefined,
        size: typeof a.size === "number" ? a.size : undefined,
        checksum: typeof a.checksum === "string" ? a.checksum : undefined,
    };
}

/** Uploads a new image into the stash (de-duplicated server-side by content). */
export async function uploadStashImage(
    file: File,
    onProgress?: (pct: number) => void,
): Promise<{ asset: UploadAssetResult; reused: boolean }> {
    const { status, json } = await uploadWithProgress("/api/admin/images", file, onProgress);
    if (status < 200 || status >= 300) {
        throw new Error(typeof json.error === "string" ? json.error : `Upload failed (${status})`);
    }
    return {
        asset: assetFromResponse(json),
        reused: json.reused === true,
    };
}

/** Replaces the bytes behind an asset, preserving its stable URL. */
export async function replaceStashImage(
    assetId: string,
    file: File,
    onProgress?: (pct: number) => void,
): Promise<ReplaceAssetResult> {
    const { status, json } = await uploadWithProgress(
        `/api/admin/images/${encodeURIComponent(assetId)}/replace`,
        file,
        onProgress,
    );
    if (status < 200 || status >= 300) {
        throw new Error(typeof json.error === "string" ? json.error : `Replace failed (${status})`);
    }
    const asset = assetFromResponse(json);
    return {
        ...asset,
        message: typeof json.message === "string" ? json.message : "Image replaced.",
    };
}

/** Deletes an unreferenced asset. Throws AssetInUseError when it is in use. */
export async function deleteStashImage(assetId: string): Promise<{ storageDeleted: boolean; message: string }> {
    const token = await authOrThrow();
    const res = await fetch(`/api/admin/images/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = parseJson(await res.text());
    if (res.status === 409) {
        const references = Array.isArray(json.references)
            ? (json.references as ImageReference[])
            : [];
        throw new AssetInUseError(
            typeof json.error === "string" ? json.error : "This image is still in use.",
            references,
        );
    }
    if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `Delete failed (${res.status})`);
    }
    return {
        storageDeleted: json.storageDeleted === true,
        message: typeof json.message === "string" ? json.message : "Image deleted.",
    };
}

/** Indexes existing alumni photos into the stash without changing them. */
export async function importAlumniImages(): Promise<{
    scanned: number;
    imported: number;
    skipped: number;
}> {
    const token = await authOrThrow();
    const res = await fetch("/api/admin/images/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    const json = parseJson(await res.text());
    if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `Import failed (${res.status})`);
    }
    return {
        scanned: typeof json.scanned === "number" ? json.scanned : 0,
        imported: typeof json.imported === "number" ? json.imported : 0,
        skipped: typeof json.skipped === "number" ? json.skipped : 0,
    };
}

/** A fresh draft asset can be discarded safely; an in-use one is protected. */
export async function discardDraftAsset(assetId: string): Promise<void> {
    try {
        await deleteStashImage(assetId);
    } catch (err) {
        // 409 means something already references it; keep the asset.
        if (!(err instanceof AssetInUseError)) {
            console.warn("[image-stash] Could not discard draft asset:", err);
        }
    }
}

/** Type guard for values that came from the Firestore asset index. */
export function isStoredImage(value: unknown): value is StoredImage {
    return !!value && typeof value === "object"
        && typeof (value as StoredImage).id === "string"
        && typeof (value as StoredImage).url === "string";
}
