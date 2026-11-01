// Permission catalog shared by client UI and server authorization.
// Server code resolves a caller's effective permissions through
// src/lib/serverAuthz.ts using this catalog; the UI only mirrors it.
//
// Backward compatibility ("legacy roles"): documents in club_roles written
// before this catalog existed have no `permissions` array. Those roles keep
// exactly the authority they had under the previous model — matching the
// Firestore rules, where any approved admin could read/update users, write
// events/resources/gallery/settings, but only the CTO could delete accounts,
// manage team access or edit roles. resolveRolePermissions() encodes that.
// CTO always holds every permission (protected invariant).

export type PermissionGroupId =
    | "Student account management"
    | "Event management"
    | "Gallery and media"
    | "Resource management"
    | "Team, alumni and site settings"
    | "Admin and role management";

export interface PermissionDef {
    id: string;
    label: string;
    description: string;
    group: PermissionGroupId;
}

export const PERMISSIONS: PermissionDef[] = [
    // Student account management
    {
        id: "students.view",
        label: "View registered students",
        description: "List and inspect student accounts (names, emails, academic details, activity).",
        group: "Student account management",
    },
    {
        id: "students.edit",
        label: "Edit student profiles",
        description: "Correct profile fields and the sign-in email on student accounts. Audited.",
        group: "Student account management",
    },
    {
        id: "students.delete",
        label: "Delete student accounts",
        description: "Permanently remove a student account and its data. Destructive; audited.",
        group: "Student account management",
    },

    // Event management
    {
        id: "events.manage",
        label: "Manage events",
        description: "Create, edit and delete events, registrations and attendance codes.",
        group: "Event management",
    },

    // Gallery and media
    {
        id: "gallery.manage",
        label: "Manage gallery media",
        description: "Upload, view and delete photos and videos stored in Backblaze B2.",
        group: "Gallery and media",
    },

    // Resource management
    {
        id: "resources.manage",
        label: "Manage resources",
        description: "Publish and remove learning resources shown on the Resources page.",
        group: "Resource management",
    },

    // Team, alumni and site settings
    {
        id: "team.manage",
        label: "Approve and revoke team access",
        description: "Approve admin requests, change member club roles and revoke admin access.",
        group: "Team, alumni and site settings",
    },
    {
        id: "alumni.manage",
        label: "Manage alumni",
        description: "Add, edit and remove alumni profiles on the Alumni page.",
        group: "Team, alumni and site settings",
    },
    {
        id: "excore.manage",
        label: "Manage Ex-Core",
        description: "Add and manage Ex-Core members and Activators: profiles, batches, role history and ordering. Profiles remain the CTO and role holders' own responsibility.",
        group: "Team, alumni and site settings",
    },
    {
        id: "settings.manage",
        label: "Change site settings",
        description: "Edit shared site settings stored in the settings collection.",
        group: "Team, alumni and site settings",
    },

    // Admin and role management
    {
        id: "roles.manage",
        label: "Edit club roles and permissions",
        description: "Create roles, edit role definitions and configure role permissions. CTO invariant: always held by the CTO.",
        group: "Admin and role management",
    },
];

export const ALL_PERMISSION_IDS: string[] = PERMISSIONS.map(p => p.id);

/** Authority held by roles that predate the permission catalog (see header). */
export const LEGACY_ADMIN_PERMISSION_IDS: string[] = [
    "students.view",
    "students.edit",
    "events.manage",
    "gallery.manage",
    "resources.manage",
    "settings.manage",
];

export function isValidPermissionId(id: unknown): boolean {
    return typeof id === "string" && ALL_PERMISSION_IDS.includes(id);
}

/**
 * Effective permission ids for a role.
 * - CTO → everything (protected system invariant, server-enforced).
 * - Legacy roles without an explicit `permissions` array → the legacy authority set.
 * - Otherwise → the stored set, filtered to known catalog ids (unknown ids are
 *   ignored rather than honored, so a corrupted write can never escalate).
 */
export function resolveRolePermissions(role: { id: string; permissions?: unknown }): string[] {
    // CTO → everything (protected system invariant, server-enforced).
    if (role.id === "CTO") return [...ALL_PERMISSION_IDS];
    // Ex-Core accounts grant nothing, even if Firestore holds a stale copy.
    if (role.id === "ExCoreMember") return [];
    if (Array.isArray(role.permissions)) {
        const known = role.permissions.filter(isValidPermissionId);
        return [...new Set(known)];
    }
    return [...LEGACY_ADMIN_PERMISSION_IDS];
}

/** PermissionDefs grouped by group, in catalog order. */
export function permissionsByGroup(): { group: PermissionGroupId; items: PermissionDef[] }[] {
    const groups: PermissionGroupId[] = [
        "Student account management",
        "Event management",
        "Gallery and media",
        "Resource management",
        "Team, alumni and site settings",
        "Admin and role management",
    ];
    return groups.map(group => ({ group, items: PERMISSIONS.filter(p => p.group === group) }));
}

/** Short human summary for the role overview, e.g. "Events, gallery + 3 more". */
export function permissionSummary(ids: string[]): string {
    const labels = ids
        .map(id => PERMISSIONS.find(p => p.id === id)?.label)
        .filter((l): l is string => !!l);
    if (labels.length === 0) return "No permissions";
    if (labels.length <= 2) return labels.join(", ");
    return `${labels[0]}, ${labels[1]} + ${labels.length - 2} more`;
}
