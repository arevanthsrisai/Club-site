import { verifyAuthToken } from "./serverAuth";
import { getAdminFirestore } from "./firebaseAdmin";
import { ALL_PERMISSION_IDS, LEGACY_ADMIN_PERMISSION_IDS, isValidPermissionId } from "./permissions";
import { DEFAULT_ROLES, CTO_ROLE, EX_CORE_ROLE } from "./roles";

/**
 * Server-enforced authorization context for admin API routes.
 *
 * This layer is the source of truth for what an authenticated admin may do:
 * - The caller must hold a verified Firebase Auth ID token.
 * - Their admins/{uid} document must exist with an approved role (not
 *   "pending") and active status (admins and the CTO).
 * - Effective permissions come from club_roles/{role}/permissions, resolved
 *   with the shared catalog in lib/permissions.ts. Load failures and unknown
 *   roles fail closed (no permissions).
 *
 * Clients can never obtain privileges merely by calling APIs: permission
 * changes written to club_roles take effect on the next request.
 */

export interface ServerAuthContext {
    uid: string;
    email?: string;
    name: string;
    role: string;
    isCTO: boolean;
    isAdmin: boolean;
    permissions: string[];
}

export async function getAdminContext(request: Request): Promise<ServerAuthContext | null> {
    try {
        const authResult = await verifyAuthToken(request);
        if (!authResult) return null;

        const db = getAdminFirestore();
        const adminDoc = await db.collection("admins").doc(authResult.uid).get();
        if (!adminDoc.exists) return null; // no admin profile → not an admin

        const data = adminDoc.data() as { role?: string; status?: string; email?: string; displayName?: string } | undefined;
        const role = data?.role ?? "";
        const name = data?.displayName || "Admin";

        if (!role || role === "pending") {
            return { uid: authResult.uid, email: data?.email, name, role, isCTO: false, isAdmin: false, permissions: [] };
        }

        const isCTO = role === CTO_ROLE.id;
        // Onboarding admins have not finished profile setup; they may use the
        // app UI once active. Management APIs require active status (or CTO).
        const isAdmin = isCTO || data?.status === "active";
        if (!isAdmin) {
            return { uid: authResult.uid, email: data?.email, name, role, isCTO, isAdmin: false, permissions: [] };
        }

        let permissions: string[] = [];
        if (isCTO) {
            permissions = [...ALL_PERMISSION_IDS];
        } else if (role === EX_CORE_ROLE.id) {
            // Ex-Core accounts hold no permissions, period. Fixed in code —
            // a stale or missing Firestore copy can never widen them.
            permissions = [];
        } else {
            try {
                const roleDoc = await db.collection("club_roles").doc(role).get();
                if (roleDoc.exists) {
                    const rd = roleDoc.data() as { permissions?: unknown } | undefined;
                    if (rd && Array.isArray(rd.permissions)) {
                        permissions = rd.permissions.filter(isValidPermissionId);
                    } else {
                        // Legacy role (pre-catalog document) keeps its previous authority.
                        permissions = [...LEGACY_ADMIN_PERMISSION_IDS];
                    }
                } else {
                    const fallback = DEFAULT_ROLES.find(r => r.id === role);
                    if (fallback) {
                        console.warn(`[serverAuthz] club_roles/${role} not yet stored; using legacy authority set.`);
                        permissions = [...LEGACY_ADMIN_PERMISSION_IDS];
                    } else {
                        // Unknown role: fail closed.
                        console.warn(`[serverAuthz] admin ${authResult.uid} has unknown role "${role}"; granting nothing.`);
                    }
                }
            } catch (err) {
                console.error(`[serverAuthz] Failed to load permissions for role "${role}"; failing closed.`, err);
                permissions = [];
            }
        }

        return { uid: authResult.uid, email: data?.email, name, role, isCTO, isAdmin, permissions };
    } catch (err) {
        console.error("[serverAuthz] Authorization context resolution failed:", err);
        return null;
    }
}

export function hasPermission(ctx: ServerAuthContext | null, permissionId: string): boolean {
    if (!ctx || !ctx.isAdmin) return false;
    if (ctx.isCTO) return true;
    return ctx.permissions.includes(permissionId);
}

/** 401/403 helpers so every route answers consistently. */
export function unauthorized() {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
}
export function forbidden(permissionId: string) {
    return Response.json({ error: `Forbidden: requires the "${permissionId}" permission` }, { status: 403 });
}

/** Server-side audit write via the Admin SDK (bypasses rules; actor is server-verified). */
export async function logServerActivity(actorUid: string, actorName: string, action: string, details: Record<string, unknown> = {}) {
    try {
        const { Timestamp } = await import("firebase-admin/firestore");
        await getAdminFirestore().collection("audit_logs").add({
            action,
            actorUid,
            actorName,
            details,
            timestamp: Timestamp.now(),
        });
    } catch (err) {
        // Audit failure must not break the operation itself.
        console.error("[serverAuthz] Audit log write failed:", err);
    }
}
