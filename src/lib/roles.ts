// Club roles are stored in Firestore (club_roles/{id}) and edited by the CTO under Manage Admins.
// Only the CTO role and the default Activator role are fixed in code, because logic depends on them.

export interface ClubRole {
    id: string;
    label: string;
    description?: string;      // human-readable purpose of the role
    rank: number;              // display order, lowest first
    limit: number | null;      // seats; null means unlimited
    permissions?: string[];    // permission identifiers
}

export const CTO_ROLE: ClubRole = { id: "CTO", label: "Chief Technology Officer", rank: 7, limit: 1 };
export const DEFAULT_ROLE_ID = "Activator";

/**
 * Fixed in code like the CTO role (never stored in Firestore): every admin
 * account moved into Ex-Core carries this role permanently. It grants
 * NOTHING — the account exists only so the person can sign in, keep their
 * Ex-Core profile and edit it via /api/ex-core/self. Restoring an account to
 * the active team hands it back the default Activator role.
 */
export const EX_CORE_ROLE: ClubRole = {
    id: "ExCoreMember",
    label: "Ex-Core Member",
    description: "A former team member whose account now lives under Ex-Core. Holds no permissions.",
    rank: 98,       // just above Activator, so listing order stays sane anywhere it appears
    limit: null,
    permissions: [],          // never grants anything
};

// Written to Firestore the first time the CTO opens Manage Admins, and used until then.
export const DEFAULT_ROLES: ClubRole[] = [
    { id: "Faculty", label: "Faculty Coordinator", rank: 1, limit: 2 },
    { id: "Mentor", label: "Mentor", rank: 2, limit: 3 },
    { id: "President", label: "President", rank: 3, limit: 1 },
    { id: "VP_AIML", label: "Vice President (AIML)", rank: 4, limit: 1 },
    { id: "VP_DSA", label: "Vice President (DSA)", rank: 4, limit: 1 },
    { id: "AdminHead", label: "Administrative Head", rank: 5, limit: 1 },
    { id: "PRHead", label: "PR Head", rank: 6, limit: 1 },
    { id: "Treasurer", label: "Treasurer", rank: 8, limit: 1 },
    { id: DEFAULT_ROLE_ID, label: "Activator", rank: 99, limit: null },
];

/** Code-fixed roles that withBuiltIns always returns, even alongside stored roles. */
const FIXED_ROLE_IDS = new Set([CTO_ROLE.id, EX_CORE_ROLE.id]);

// Adds the CTO and Ex-Core Member (both fixed in code) and sorts by rank. Falls back to the defaults before the first save.
export function withBuiltIns(stored: ClubRole[]): ClubRole[] {
    const roles = stored.filter(r => !FIXED_ROLE_IDS.has(r.id));
    const list = roles.length ? roles : DEFAULT_ROLES.filter(r => !FIXED_ROLE_IDS.has(r.id));
    // Preserve the stored CTO role (with its saved rank) if present; otherwise
    // insert the built-in CTO with its default rank. Never pin CTO to a fixed
    // position — the saved rank must be honored.
    const storedCto = stored.find(r => r.id === CTO_ROLE.id);
    const cto = storedCto ? { ...CTO_ROLE, rank: storedCto.rank } : CTO_ROLE;
    return [...list, cto, EX_CORE_ROLE].sort((a, b) => a.rank - b.rank);
}

/**
 * Canonical member ordering used by EVERY page that lists team members
 * (/about, /admin/team): primary key is the role's precedence (`rank`, lowest
 * first), secondary is a stable member order inside a role (displayName,
 * then uid) so refreshes, devices and concurrent renders agree.
 */
export function sortMembersByRole<T extends { role: string; displayName?: string; uid: string }>(
    members: T[],
    roles: ClubRole[],
): T[] {
    const key = (m: T) => `${roleRank(roles, m.role)}::${(m.displayName || m.uid).toLowerCase()}::${m.uid}`;
    // Use numeric comparison for the role rank portion by extracting it
    return [...members].sort((a, b) => {
        const rankA = roleRank(roles, a.role);
        const rankB = roleRank(roles, b.role);
        if (rankA !== rankB) {
            return rankA - rankB;
        }
        const nameA = (a.displayName || a.uid).toLowerCase();
        const nameB = (b.displayName || b.uid).toLowerCase();
        if (nameA !== nameB) {
            return nameA.localeCompare(nameB);
        }
        return a.uid.localeCompare(b.uid);
    });
}

/**
 * Drag-to-top semantics: moving a role onto another returns the full new
 * ordering with contiguous ranks (10, 20, 30, …). Only the CTO persists this.
 */
export function reorderRoles(roles: ClubRole[], draggedId: string, ontoId: string): ClubRole[] {
    if (draggedId === ontoId) return roles;
    const order = [...roles].sort((a, b) => a.rank - b.rank);
    const fromIndex = order.findIndex(r => r.id === draggedId);
    const toIndex = order.findIndex(r => r.id === ontoId);
    if (fromIndex === -1 || toIndex === -1) return roles;
    const [dragged] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, dragged);
    return order.map((r, i) => ({ ...r, rank: (i + 1) * 10 }));
}

export function roleLabel(roles: ClubRole[], id: string): string {
    return roles.find(r => r.id === id)?.label ?? id;
}

export function roleRank(roles: ClubRole[], id: string): number {
    return roles.find(r => r.id === id)?.rank ?? 999;
}

// "Events Lead" -> "Events_Lead". Ids never change after creation, so renaming a role keeps its holders.
export function roleIdFromLabel(label: string): string {
    return label.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
