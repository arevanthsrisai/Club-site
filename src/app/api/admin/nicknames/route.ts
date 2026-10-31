import { NextResponse } from "next/server";
import { getAdminContext, unauthorized, forbidden, logServerActivity } from "@/lib/serverAuthz";
import { getAdminFirestore, } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/**
 * Club-role admin NICKNAMES — CTO-only management.
 *
 * A nickname is a searchable display helper stored on admins/{uid}.nickname.
 * It is NEVER part of authorization: accounts sign in and are authorized by
 * their real (normalized) email and their role. This route enforces the CTO
 * boundary server-side — a non-CTO admin calling these endpoints directly
 * gets 403 even if they found the endpoint, and Firestore rules additionally
 * deny non-CTO writes to admins documents that change this field.
 *
 * POST   { uid, nickname }   set/replace (empty string removes it)
 * DELETE { "uid": "…" }      explicit removal
 * GET    — not needed; admins read admins/{uid} through the client SDK
 */

const MAX_NICKNAME_LENGTH = 80;

function cleanNickname(raw: unknown): string {
    if (typeof raw !== "string") return "";
    return raw.trim().replace(/\s+/g, " ").slice(0, MAX_NICKNAME_LENGTH);
}

export async function POST(request: Request) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    // Server-side CTO-only enforcement — the UI hides nothing on its own trust.
    if (!ctx.isCTO) return forbidden("CTO");

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const uid = typeof (body as any)?.uid === "string" ? (body as any).uid.trim() : "";
    const nickname = cleanNickname((body as any)?.nickname);
    if (!uid || !/^[A-Za-z0-9_-]{10,64}$/.test(uid)) {
        return NextResponse.json({ error: "A valid admin account id is required." }, { status: 400 });
    }

    const db = getAdminFirestore();
    const adminRef = db.collection("admins").doc(uid);
    const snap = await adminRef.get();
    if (!snap.exists) return NextResponse.json({ error: "No admin account with that id." }, { status: 404 });

    const target = snap.data() as { email?: string; nickname?: string };
    if (nickname.length > 0 && nickname.length < 2) {
        return NextResponse.json({ error: "Nicknames need at least 2 characters." }, { status: 400 });
    }

    // Duplicate nicknames are ambiguous for search, so they are rejected with
    // the blocking admin shown — except the same admin keeping their own.
    if (nickname) {
        const dupQuery = await db.collection("admins").where("nickname", "==", nickname).get();
        const duplicate = dupQuery.docs.find(d => d.id !== uid);
        if (duplicate) {
            return NextResponse.json(
                { error: `That nickname already belongs to ${duplicate.data().email || duplicate.id}. Nicknames must be unique.` },
                { status: 409 }
            );
        }
    }

    await adminRef.update({ nickname: nickname || FieldValue.delete() });
    await logServerActivity(ctx.uid, ctx.name, nickname ? "Nickname assigned" : "Nickname removed", {
        targetUid: uid,
        targetEmail: target.email || "",
        ...(nickname ? { nickname } : {}),
    });

    return NextResponse.json({ ok: true, nickname: nickname || "" });
}

export async function DELETE(request: Request) {
    const ctx = await getAdminContext(request);
    if (!ctx) return unauthorized();
    if (!ctx.isCTO) return forbidden("CTO");

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const uid = typeof (body as any)?.uid === "string" ? (body as any).uid.trim() : "";
    if (!uid) return NextResponse.json({ error: "uid is required." }, { status: 400 });

    const db = getAdminFirestore();
    const adminRef = db.collection("admins").doc(uid);
    const snap = await adminRef.get();
    if (!snap.exists) return NextResponse.json({ error: "No admin account with that id." }, { status: 404 });

    await adminRef.update({ nickname: FieldValue.delete() });
    await logServerActivity(ctx.uid, ctx.name, "Nickname removed", { targetUid: uid });
    return NextResponse.json({ ok: true });
}
