import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { assetReferenceCandidates } from "@/lib/imageStash";

/**
 * Server-side reference lookup for a stash asset.
 *
 * Deleting an image that a profile still points at would silently break that
 * profile, so deletion first asks every admin-managed collection whether it
 * stores this asset's friendly URL, B2 key, or gallery delivery URL.
 *
 * Only equality `in` queries are used (no indexes to provision beyond the
 * automatic single-field ones), and this runs solely on delete/replace UX
 * actions, never on page loads.
 */

export interface ImageReference {
    collection: string;
    field: string;
    id: string;
    label: string;
}

interface ReferenceTarget {
    collection: string;
    field: string;
    /** Field used to give the admin a recognizable name. */
    labelField: string;
}

const REFERENCE_TARGETS: ReferenceTarget[] = [
    { collection: "alumni", field: "photoURL", labelField: "name" },
    { collection: "admins", field: "photoURL", labelField: "displayName" },
    { collection: "ex_core_members", field: "photoURL", labelField: "name" },
    { collection: "events", field: "image", labelField: "title" },
    { collection: "resources", field: "url", labelField: "title" },
    { collection: "resources", field: "thumbnailUrl", labelField: "title" },
    { collection: "gallery", field: "src", labelField: "alt" },
];

const MAX_REFERENCES_REPORTED = 12;

export async function findImageReferences(asset: { id: string; key?: string | null }): Promise<ImageReference[]> {
    const candidates = assetReferenceCandidates({ id: asset.id, key: asset.key ?? null });
    if (candidates.length === 0) return [];

    const db = getAdminFirestore();
    const found: ImageReference[] = [];
    const seen = new Set<string>();

    await Promise.all(REFERENCE_TARGETS.map(async target => {
        try {
            const snap = await db.collection(target.collection)
                .where(target.field, "in", candidates)
                .limit(MAX_REFERENCES_REPORTED)
                .get();
            for (const doc of snap.docs) {
                const key = `${target.collection}:${doc.id}:${target.field}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const data = doc.data() as Record<string, unknown>;
                const rawLabel = data?.[target.labelField];
                const label = typeof rawLabel === "string" && rawLabel.trim()
                    ? rawLabel.trim()
                    : `${target.collection}/${doc.id}`;
                found.push({
                    collection: target.collection,
                    field: target.field,
                    id: doc.id,
                    label,
                });
            }
        } catch (err) {
            // A missing collection or an unindexed field must not make the
            // asset look unused. Treat an unreadable target as "may be used"
            // so deletion fails closed instead of breaking content.
            console.error(`[imageReferences] Could not scan ${target.collection}.${target.field}:`, err);
            found.push({
                collection: target.collection,
                field: target.field,
                id: "unknown",
                label: `${target.collection} (could not be checked)`,
            });
        }
    }));

    return found.slice(0, MAX_REFERENCES_REPORTED);
}

/** Human summary of where an asset is used, for API error bodies. */
export function describeReferences(refs: ImageReference[]): string {
    if (refs.length === 0) return "This image is not referenced.";
    const names = [...new Set(refs.map(r => r.label))].slice(0, 4);
    const suffix = refs.length > names.length ? ` and ${refs.length - names.length} more` : "";
    return `Used by ${names.join(", ")}${suffix}.`;
}
