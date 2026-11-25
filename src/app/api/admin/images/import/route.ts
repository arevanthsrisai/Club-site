import { NextResponse } from "next/server";
import {
    getAdminContext,
    forbidden,
    logServerActivity,
    unauthorized,
} from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
    extractStorageKey,
    filenameFromUrl,
    friendlyImageUrl,
} from "@/lib/imageStash";
import { validateKey } from "@/lib/objectStorage";

export const dynamic = "force-dynamic";

interface ImportedCandidate {
    url: string;
    label: string;
}

/**
 * POST /api/admin/images/import
 *
 * Indexes images that already exist on alumni profiles into the Image Stash
 * so admins can find and reuse them in one place.
 *
 * This is an additive index only:
 * - existing profile `photoURL` values are never rewritten;
 * - no bytes are copied or moved;
 * - duplicate source URLs are skipped, and re-running the import is safe.
 *
 * Where a photo already lives in our B2 bucket its key is recorded and the
 * friendly asset URL serves it directly. Firebase Storage / external images
 * are indexed as `provider: "external"` and their friendly URL redirects to
 * the original; deleting such an asset removes only the index entry.
 */
export async function POST(request: Request) {
    try {
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        if (!ctx.isCTO && !ctx.permissions.includes("gallery.manage")) {
            return forbidden("gallery.manage");
        }

        const db = getAdminFirestore();
        const [alumniSnap, existingSnap] = await Promise.all([
            db.collection("alumni").select("name", "photoURL").limit(1000).get(),
            db.collection("image_assets").select("sourceUrl", "url").limit(2000).get(),
        ]);

        const alreadyIndexed = new Set<string>();
        for (const doc of existingSnap.docs) {
            const data = doc.data() as { sourceUrl?: unknown; url?: unknown };
            if (typeof data.sourceUrl === "string") alreadyIndexed.add(data.sourceUrl);
            if (typeof data.url === "string") alreadyIndexed.add(data.url);
        }

        const candidates = new Map<string, ImportedCandidate>();
        for (const doc of alumniSnap.docs) {
            const data = doc.data() as { name?: unknown; photoURL?: unknown };
            if (typeof data.photoURL !== "string") continue;
            const url = data.photoURL.trim();
            if (!url || url.startsWith("data:") || url.startsWith("blob:")) continue;
            if (alreadyIndexed.has(url)) continue;
            if (candidates.has(url)) continue;
            candidates.set(url, {
                url,
                label: typeof data.name === "string" ? data.name : `alumni/${doc.id}`,
            });
        }

        const { FieldValue } = await import("firebase-admin/firestore");
        let imported = 0;
        let skipped = 0;

        for (const candidate of candidates.values()) {
            const key = extractStorageKey(candidate.url);
            const b2Key = key && validateKey(key) ? key : null;
            const id = crypto.randomUUID();
            try {
                await db.collection("image_assets").doc(id).set({
                    url: friendlyImageUrl(id),
                    key: b2Key,
                    externalUrl: b2Key ? null : candidate.url,
                    provider: b2Key ? "b2" : "external",
                    source: "imported",
                    sourceUrl: candidate.url,
                    sourceCollection: "alumni",
                    filename: filenameFromUrl(candidate.url),
                    contentType: "",
                    size: 0,
                    checksum: "",
                    revision: 1,
                    uploadedBy: ctx.uid,
                    uploadedByName: ctx.name,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
                imported += 1;
            } catch (err) {
                // A single bad record must not abort the whole index build.
                console.error(`[image-stash] Could not index ${candidate.label}:`, err);
                skipped += 1;
            }
        }

        await logServerActivity(ctx.uid, ctx.name, "IMPORT_IMAGE_ASSETS", {
            scanned: alumniSnap.size,
            imported,
            skipped,
        });

        return NextResponse.json({
            scanned: alumniSnap.size,
            imported,
            skipped,
            alreadyIndexed: alumniSnap.size - candidates.size - skipped,
        });
    } catch (err) {
        console.error("[image-stash] Import failed:", err);
        const message = err instanceof Error ? err.message : "Import failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
