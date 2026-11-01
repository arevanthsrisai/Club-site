import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, hasPermission, logServerActivity, unauthorized } from "@/lib/serverAuthz";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
    normalizeYear, sanitizeRoleHistory, ExCoreMemberType,
} from "@/lib/excore";
import { DEFAULT_ROLE_ID, EX_CORE_ROLE } from "@/lib/roles";
import { safeHttpUrl } from "@/lib/publicUrl";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

/**
 * Server API for Ex-Core membership management.
 *
 * GET    → list all members (server-side data copy; the public page may also
 *          read the same collection with public rules, but contains only
 *          public profile fields).
 * POST   → add a member: move an existing team account (keeps sign-in working
 *          and links the profile for self-editing) or create a standalone one.
 * PATCH  → edit any member profile (batch, classification, role history,
 *          ordering-relevant fields, bio/socials/photo, linked account).
 * DELETE → remove a member from Ex-Core (and free their linked account again).
 *
 * Authorization: isCTO OR the "excore.manage" permission, resolved server-side
 * from the caller's verified ID token — never from anything the client sends.
 * Owners of a linked account can only change their own profile fields via
 * /api/ex-core/self, never here.
 */

export async function GET() {
    try {
        const snap = await getAdminFirestore().collection("ex_core_members").get();
        return NextResponse.json({ members: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (err: any) {
        console.error("GET /api/ex-core failed:", err);
        return NextResponse.json({ error: "Failed to load Ex-Core members." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "excore.manage")) {
        return NextResponse.json({ error: "Forbidden: requires the \"excore.manage\" permission" }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const batch = normalizeYear(body?.exCoreBatch);
        if (batch === null) {
            return NextResponse.json(
                { error: "A valid Ex-Core batch (academic-year start, e.g. 2027) is required." },
                { status: 400 },
            );
        }
        const memberType: ExCoreMemberType = body?.memberType === "activator" ? "activator" : "core";
        const sourceAdminUid = typeof body?.sourceAdminUid === "string" ? body.sourceAdminUid.trim() : "";
        const standaloneName = typeof body?.name === "string" ? body.name.trim() : "";

        const db = getAdminFirestore();

        // Optional role-history seed (validated + deduped + sorted server-side).
        const roleHistory = sanitizeRoleHistory(body?.roleHistory);

        if (!sourceAdminUid && !standaloneName) {
            return NextResponse.json({ error: "Provide a team account or a name." }, { status: 400 });
        }

        const result = await db.runTransaction(async (tx) => {
            let profile: {
                name: string; photoURL?: string | null; socials?: Record<string, string | null>;
                bio?: string; linkedUserId?: string | null;
            };

            if (sourceAdminUid) {
                // Moving a team account: the record comes from the verified
                // admins doc, never from client-supplied identity.
                const adminRef = db.collection("admins").doc(sourceAdminUid);
                const adminSnap = await tx.get(adminRef);
                if (!adminSnap.exists) {
                    throw new Error("NOT_FOUND");
                }
                const a = adminSnap.data() as {
                    displayName?: string; email?: string; photoURL?: string | null;
                    socials?: Record<string, string | null>; status?: string; exCoreAt?: unknown; role?: string;
                };
                // Never move the account twice, and never move the CTO — the
                // Ex-Core role would strip their protected permissions.
                if (a.exCoreAt) {
                    throw new Error("ALREADY_EXCORE");
                }
                if (a.role === "CTO") {
                    throw new Error("CTO_MOVE_DENIED");
                }
                profile = {
                    name: (a.displayName || a.email || standaloneName).trim(),
                    photoURL: a.photoURL ?? null,
                    // Only safe profile links travel to the public collection.
                    socials: a.socials ?? {},
                    bio: "",
                    // The moved account may self-edit its Ex-Core profile.
                    linkedUserId: sourceAdminUid,
                };
            } else {
                profile = { name: standaloneName, photoURL: null, socials: {}, bio: "", linkedUserId: null };
            }

            // Persisted custom ordering: append at the end of the batch.
            const siblings = await tx.get(
                db.collection("ex_core_members").where("exCoreBatch", "==", batch),
            );
            const nextOrder = siblings.docs.reduce(
                (max, d) => Math.max(max, Number((d.data() as { displayOrder?: number }).displayOrder ?? -1) + 1),
                0,
            );

            const ref = db.collection("ex_core_members").doc();
            tx.set(ref, {
                ...profile,
                memberType,
                exCoreBatch: batch,
                roleHistory: roleHistory ?? [],
                displayOrder: nextOrder,
                movedAt: Timestamp.now(),
            });

            if (sourceAdminUid) {
                // Explicit, auditable hand-off out of the active team listings:
                // the account moves under Ex-Core FOR GOOD — its club role
                // becomes "Ex-Core Member" (grants nothing) and `exCoreAt`
                // keeps the team pages from listing it.
                tx.set(
                    db.collection("admins").doc(sourceAdminUid),
                    { exCoreAt: Timestamp.now(), role: EX_CORE_ROLE.id },
                    { merge: true },
                );
            }
            return ref.id;
        });

        await logServerActivity(ctx.uid, ctx.name, "EXCORE_MEMBER_ADD", {
            memberId: result,
            sourceAdminUid: sourceAdminUid || null,
            exCoreBatch: batch,
            memberType,
        });

        return NextResponse.json({ id: result });
    } catch (err: any) {
        if (err?.message === "NOT_FOUND") {
            return NextResponse.json({ error: "That team account does not exist." }, { status: 400 });
        }
        if (err?.message === "ALREADY_EXCORE") {
            return NextResponse.json({ error: "That account is already in Ex-Core." }, { status: 400 });
        }
        if (err?.message === "CTO_MOVE_DENIED") {
            return NextResponse.json({ error: "The CTO account cannot be moved to Ex-Core." }, { status: 400 });
        }
        console.error("POST /api/ex-core failed:", err);
        return NextResponse.json({ error: "Failed to add the Ex-Core member." }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "excore.manage")) {
        return NextResponse.json({ error: "Forbidden: requires the \"excore.manage\" permission" }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({}));

        // Managed-section convenience: return a moved account to the Active
        // Team without needing the profile id (used when the Ex-Core profile
        // no longer exists or the caller only knows the admin uid).
        if (typeof body?.restoreAdminUid === "string") {
            const uid = body.restoreAdminUid.trim();
            if (!uid) return NextResponse.json({ error: "restoreAdminUid is required." }, { status: 400 });
            const restoreDb = getAdminFirestore();
            const linkedQuery = await restoreDb.collection("ex_core_members").where("linkedUserId", "==", uid).get();
            if (!linkedQuery.empty) {
                await linkedQuery.docs[0].ref.set({ linkedUserId: null }, { merge: true });
            }
            await restoreLinkedAdmin(restoreDb, uid);
            await logServerActivity(
                ctx.uid, ctx.name, "EXCORE_ADMIN_RESTORED",
                { adminUid: uid, memberId: linkedQuery.empty ? null : linkedQuery.docs[0].id },
            );
            return NextResponse.json({ success: true });
        }

        const id = typeof body?.id === "string" ? body.id : "";
        if (!id) return NextResponse.json({ error: "Member id is required." }, { status: 400 });

        const db = getAdminFirestore();
        const ref = db.collection("ex_core_members").doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
            return NextResponse.json({ error: "That Ex-Core member does not exist." }, { status: 404 });
        }

        const update: Record<string, unknown> = {};

        if (body?.name !== undefined) {
            const name = String(body.name).trim();
            if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
            update.name = name;
        }
        if (body?.memberType !== undefined) {
            update.memberType = body.memberType === "activator" ? "activator" : "core";
        }
        if (body?.exCoreBatch !== undefined) {
            const batch = normalizeYear(body.exCoreBatch);
            if (batch === null) {
                return NextResponse.json({ error: "Invalid Ex-Core batch." }, { status: 400 });
            }
            update.exCoreBatch = batch;
        }
        if (body?.roleHistory !== undefined) {
            const history = sanitizeRoleHistory(body.roleHistory);
            update.roleHistory = history ?? [];
        }
        if (body?.bio !== undefined) {
            update.bio = String(body.bio).slice(0, 2000);
        }
        if (body?.photoURL !== undefined) {
            update.photoURL = safeHttpUrl(String(body.photoURL || ""));
        }
        if (body?.socials !== undefined) {
            const s = body.socials ?? {};
            update.socials = {
                linkedin: safeHttpUrl(String(s.linkedin || "")),
                github: safeHttpUrl(String(s.github || "")),
                instagram: safeHttpUrl(String(s.instagram || "")),
            };
        }
        if (body?.linkedUserId !== undefined) {
            const linked = typeof body.linkedUserId === "string" ? body.linkedUserId.trim() : "";
            if (linked) {
                const adminSnap = await db.collection("admins").doc(linked).get();
                if (!adminSnap.exists) {
                    return NextResponse.json({ error: "Linked account not found." }, { status: 400 });
                }
                if ((adminSnap.data() as { role?: string })?.role === "CTO") {
                    return NextResponse.json({ error: "The CTO account cannot be linked to Ex-Core." }, { status: 400 });
                }
            }
            update.linkedUserId = linked || null;
        }

        if (Object.keys(update).length === 0) {
            return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
        }

        // displayOrder is not patchable here — ordering only via /reorder,
        // which normalizes whole batches.
        await ref.update(update);

        // Keep the linked account's hand-off status consistent when the CTO
        // re-links or unlinks an Ex-Core profile.
        let unlinkedAdminUid: string | null = null;
        let newLinkedAdminUid: string | null = null;
        if (update.linkedUserId !== undefined) {
            const current = snap.data() as { linkedUserId?: string | null };
            const prev = current.linkedUserId || null;
            const next = (update.linkedUserId as string | null) || null;
            if (prev !== next) {
                // Un-linking (or re-linking) returns the old account to the Active Team.
                if (prev && prev !== next) {
                    await restoreLinkedAdmin(db, prev);
                    unlinkedAdminUid = prev;
                }
                // A brand-new link moves that account under Ex-Core as well.
                if (next && next !== prev) {
                    await db.collection("admins").doc(next).set(
                        { exCoreAt: Timestamp.now(), role: EX_CORE_ROLE.id },
                        { merge: true },
                    );
                    newLinkedAdminUid = next;
                }
            }
        }

        await logServerActivity(ctx.uid, ctx.name, "EXCORE_MEMBER_UPDATE", {
            memberId: id, fields: Object.keys(update),
            unlinkedAdminUid, newLinkedAdminUid,
        });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("PATCH /api/ex-core failed:", err);
        return NextResponse.json({ error: "Failed to update the Ex-Core member." }, { status: 500 });
    }
}

/**
 * Return an admin account to the Active Team: clear the `exCoreAt` hand-off and
 * drop the Ex-Core Member role (only when the account actually carries it —
 * accounts moved before this role existed keep their original club role).
 */
async function restoreLinkedAdmin(db: ReturnType<typeof getAdminFirestore>, uid: string) {
    const ref = db.collection("admins").doc(uid);
    const snap = await ref.get();
    const currentRole = (snap.data() as { role?: string } | undefined)?.role;
    const update: Record<string, unknown> = { exCoreAt: FieldValue.delete() };
    if (currentRole === EX_CORE_ROLE.id) update.role = DEFAULT_ROLE_ID;
    await ref.set(update, { merge: true });
}

export async function DELETE(request: NextRequest) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!hasPermission(ctx, "excore.manage")) {
        return NextResponse.json({ error: "Forbidden: requires the \"excore.manage\" permission" }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const id = typeof body?.id === "string" ? body.id : "";
        if (!id) return NextResponse.json({ error: "Member id is required." }, { status: 400 });

        const db = getAdminFirestore();
        const ref = db.collection("ex_core_members").doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
            return NextResponse.json({ error: "That Ex-Core member does not exist." }, { status: 404 });
        }

        await ref.delete();

        const linked = (snap.data() as { linkedUserId?: string | null }).linkedUserId;
        if (linked) {
            // Removing them from Ex-Core returns the account to the team lists
            // with its normal role again.
            await restoreLinkedAdmin(db, linked);
        }

        await logServerActivity(ctx.uid, ctx.name, "EXCORE_MEMBER_DELETE", {
            memberId: id,
            name: (snap.data() as { name?: string }).name || "",
            restoredAdminUid: linked || null,
        });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("DELETE /api/ex-core failed:", err);
        return NextResponse.json({ error: "Failed to remove the Ex-Core member." }, { status: 500 });
    }
}
