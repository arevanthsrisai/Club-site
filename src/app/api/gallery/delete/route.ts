import { NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/serverAuth";
import { getAdminContext, hasPermission, logServerActivity } from "@/lib/serverAuthz";
import { getStorageConfig, deleteObjectPermanent, validateKey } from "@/lib/objectStorage";

/**
 * Deletes a gallery item's stored objects from the configured object store
 * (Backblaze B2, or legacy Cloudflare R2 while files migrate). Admin-only
 * server check (gallery.manage permission), and every key must match our
 * approved namespace so no other part of the bucket can be reached.
 *
 * Accepts { key } (the primary object) and also { thumbnailKey } /
 * { originalKey } so a video's poster frame and preserved original are cleaned
 * up in the same operation instead of leaking as orphaned objects.
 */
export async function POST(request: Request) {
    const auth = await verifyAuthToken(request);
    if (!auth) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    // Permission-checked admin authorization (fail closed).
    const ctx = await getAdminContext(request);
    if (!ctx || !ctx.isAdmin) return NextResponse.json({ error: "Only approved admins can delete gallery media." }, { status: 403 });
    if (!hasPermission(ctx, "gallery.manage")) {
        return NextResponse.json({ error: "Forbidden: requires the \"gallery.manage\" permission" }, { status: 403 });
    }

    const config = getStorageConfig();
    if (!config) return NextResponse.json({ error: "Gallery object storage is not configured on this server." }, { status: 503 });

    const body = await request.json().catch(() => null);
    const primary = typeof body?.key === "string" ? body.key : "";
    const extras = [
        typeof body?.thumbnailKey === "string" ? body.thumbnailKey : "",
        typeof body?.originalKey === "string" ? body.originalKey : "",
    ].filter(Boolean) as string[];

    if (!primary) {
        return NextResponse.json({ error: "An object key is required." }, { status: 400 });
    }
    // Every key in this request must be inside our approved namespaces; this
    // also double-checks extras were not smuggled in as traversal strings.
    const validKeys = [primary, ...extras];
    const invalid = validKeys.find((k) => {
        // Gallery keys that arrived before namespaces existed are UUID-rooted.
        return !validateKey(k) && !/^[0-9a-f-]{36}-[\w.-]+$/.test(k);
    });
    if (invalid) {
        return NextResponse.json({ error: "Invalid object key." }, { status: 400 });
    }

    try {
        const failures: string[] = [];
        for (const key of validKeys) {
            try {
                await deleteObjectPermanent(config, key);
            } catch (err) {
                // The primary delete failing is fatal to the request; extras
                // are collected so the response reports partial cleanup.
                if (key === primary) throw err;
                failures.push(key.split("/").pop() ?? key);
            }
        }
        await logServerActivity(ctx.uid, ctx.name, "Deleted gallery media", {
            count: validKeys.length,
            withExtras: extras.length > 0,
        });
        return NextResponse.json({ success: true, ...(failures.length ? { partialFailures: failures } : {}) });
    } catch (error) {
        console.error("Gallery delete failed:", error);
        return NextResponse.json({ error: "Deletion from storage failed." }, { status: 500 });
    }
}
