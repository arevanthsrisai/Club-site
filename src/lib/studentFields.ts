// Zod schema for editable student profile fields.
// Shared by the /api/admin/students PATCH handler (server-side validation)
// and importable in unit tests without any Firebase dependency.
//
// Mass-assignment protection: schema is strict() — fields outside this list
// (role, admin flags, uid, timestamps, auth metadata) are rejected, so a
// profile edit can never grant or revoke administrative privileges.
//
// Verification comes from Firebase emailVerified, not from this form.
import { z } from "zod";

export const studentPatchSchema = z.object({
    uid: z.string().min(1).max(128),
    data: z
        .object({
            displayName: z.string().trim().max(60, "Name must be under 60 characters").optional(),
            email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200).optional(),
            rollNo: z.string().trim().max(30, "Roll number must be under 30 characters").optional(),
            class: z.string().trim().max(30, "Department must be under 30 characters").optional(),
            section: z.string().trim().max(10, "Section must be under 10 characters").optional(),
            mobile: z.string().trim().max(15, "Mobile number must be under 15 characters")
                .regex(/^\+?[0-9\- ]*$/, "Mobile number can only contain digits, spaces, hyphens and a leading +").optional(),
            hosteller: z.boolean().optional(),
        })
        .strict(), // unknown fields rejected
});

export type StudentPatch = z.infer<typeof studentPatchSchema>;
