import { NextRequest, NextResponse } from "next/server";
import { getAdminContext } from "@/lib/serverAuthz";
import { saveRole as saveRoleToFirestore, deleteRole as deleteRoleFromFirestore } from "@/services/roles";
import { EX_CORE_ROLE } from "@/lib/roles";

/**
 * Server-side API for CTO-only role operations.
 *
 * POST /api/admin/roles/save
 * DELETE /api/admin/roles/delete
 *
 * Exposes the same client-side saveRole/deleteRole function signatures
 * but enforces CTO-only authorization server-side.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { id, label, permissions, rank, limit } = body as {
            id?: string;
            label?: string;
            permissions?: unknown;
            rank?: number;
            limit?: number | null;
        };

        // Enforce CTO-only
        const ctx = await getAdminContext(request);
        if (!ctx || !ctx.isCTO) {
            return NextResponse.json({ error: "Only the CTO can create or edit roles" }, { status: 403 });
        }

        if (!id || typeof id !== "string") {
            return NextResponse.json({ error: "Role id is required" }, { status: 400 });
        }

        if (!label || typeof label !== "string") {
            return NextResponse.json({ error: "Role label is required" }, { status: 400 });
        }

        const trimmedLabel = label.trim();
        if (trimmedLabel.length < 1 || trimmedLabel.length > 64) {
            return NextResponse.json({ error: "Role label must be 1-64 characters" }, { status: 400 });
        }

        const nRank = Number(rank);
        if (Number.isNaN(nRank) || nRank < 1 || nRank > 9999) {
            return NextResponse.json({ error: "Rank must be between 1 and 9999" }, { status: 400 });
        }

        const nLimit = limit === null || limit === undefined ? null : Number(limit);
        if (nLimit !== null && (Number.isNaN(nLimit) || nLimit < 1)) {
            return NextResponse.json({ error: "Seat limit must be null or a positive number" }, { status: 400 });
        }

        let resolvedPermissions: string[] = [];
        if (permissions !== undefined && permissions !== null) {
            const permArr = Array.isArray(permissions) ? permissions : [permissions];
            const validPrefixes = ["students.", "events.", "gallery.", "resources.", "team.", "settings.", "alumni.", "roles."];
            for (const p of permArr) {
                if (typeof p !== "string") continue;
                if (validPrefixes.some(prefix => p.startsWith(prefix))) {
                    resolvedPermissions.push(p);
                }
            }
            if (!resolvedPermissions.every((v, i, a) => a.indexOf(v) === i)) {
                return NextResponse.json({ error: "Permissions cannot contain duplicates" }, { status: 400 });
            }
        }

        // Ex-Core Member must never gain permissions: write an explicit empty
        // set so even a stale Firestore copy is wiped. Other roles keep the
        // existing behavior (permissions are managed by the UI toggle save).
        const isExCoreMember = id === EX_CORE_ROLE.id;

        // Persist the role
        await saveRoleToFirestore(
            isExCoreMember
                ? { id, label: trimmedLabel, rank: nRank, limit: nLimit, permissions: [] }
                : { id, label: trimmedLabel, rank: nRank, limit: nLimit },
            ctx.uid,
            ctx.name || "Admin",
        );

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("Error saving role:", err);
        return NextResponse.json({ error: "Failed to save role: " + err.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { id } = body as { id?: string };

        if (!id || typeof id !== "string") {
            return NextResponse.json({ error: "Role id is required" }, { status: 400 });
        }

        // Enforce CTO-only
        const ctx = await getAdminContext(request);
        if (!ctx || !ctx.isCTO) {
            return NextResponse.json({ error: "Only the CTO can delete roles" }, { status: 403 });
        }

        // CTO, Activator and Ex-Core Member cannot be deleted.
        if (id === "CTO" || id === "Activator" || id === EX_CORE_ROLE.id) {
            return NextResponse.json({ error: "Cannot delete the CTO, Activator or Ex-Core Member role" }, { status: 400 });
        }

        // Delete the role
        await deleteRoleFromFirestore(id, ctx.uid, ctx.name || "Admin");

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("Error deleting role:", err);
        return NextResponse.json({ error: "Failed to delete role: " + err.message }, { status: 500 });
    }
}