import { NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/serverAuth";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { getStorageConfig } from "@/lib/objectStorage";

/**
 * Read-only capability check so the gallery UI can offer the object-store
 * upload path only when the server is actually configured for it. Reveals no
 * credential material — just the provider name, a boolean, and any missing
 * variable names.
 */
export async function GET(request: Request) {
    const auth = await verifyAuthToken(request);
    if (!auth) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    try {
        const admin = (await getAdminFirestore().collection("admins").doc(auth.uid).get()).data();
        if (!admin || admin.status !== "active" || admin.role === "pending") {
            return NextResponse.json({ error: "Admins only." }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "Admin verification is temporarily unavailable." }, { status: 503 });
    }

    const config = getStorageConfig();
    // Which variable set applies given what exists right now — tells the admin
    // exactly what to add (B2 gear) without showing anything set.
    const keys = ["B2_S3_ENDPOINT", "B2_REGION", "B2_BUCKET_NAME", "B2_APPLICATION_KEY_ID", "B2_APPLICATION_KEY"];
    const missing = keys.filter((k) => !process.env[k]);
    return NextResponse.json({
        storageConfigured: config !== null,
        provider: config?.provider ?? null,
        missingKeys: config ? [] : missing,
    });
}
