/**
 * Admin signup requests.
 *
 * A request is actionable only while the account behind it is still
 * unapproved. The request document can outlive the signup — for example when
 * a pending person finishes self-service onboarding as Ex-Core — so every
 * approve/reject path and the CTO's pending list use this single rule.
 */

export const PENDING_SIGNUP_ROLE = "pending";

/**
 * True when the account behind a request may still be approved or rejected.
 *
 * - `undefined` means no admin profile exists yet (an Auth account whose
 *   profile write failed); the request is the only record left, so it stays
 *   recoverable.
 * - Only the `pending` role is an unapproved account. Anything else has
 *   already been approved, moved to Ex-Core, or promoted, and must never be
 *   reset or deleted by a stale request.
 */
export function isPendingSignup(adminRole: string | null | undefined): boolean {
    return adminRole === undefined || adminRole === null || adminRole === PENDING_SIGNUP_ROLE;
}
