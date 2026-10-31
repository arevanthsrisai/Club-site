/**
 * Rate limiting for API routes.
 *
 * Uses an in-memory sliding window counter. Designed to be swappable
 * for Redis-backed implementation in multi-instance deployments.
 *
 * Key format: "ratelimit:{action}:{uid}" — per-user, per-action limits.
 */

type RateLimitStore = {
    increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
    reset(key: string): Promise<void>;
};

class InMemoryRateLimitStore implements RateLimitStore {
    private readonly buckets = new Map<string, { count: number; resetAt: number; windowMs: number }>();
    private readonly cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Periodic cleanup of expired buckets
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
        this.cleanupInterval.unref(); // Don't prevent process exit
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, bucket] of this.buckets.entries()) {
            if (bucket.resetAt < now) {
                this.buckets.delete(key);
            }
        }
    }

    async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
        const now = Date.now();
        const bucket = this.buckets.get(key);

        if (!bucket || bucket.resetAt < now) {
            // New window
            this.buckets.set(key, { count: 1, resetAt: now + windowMs, windowMs });
            return { count: 1, resetAt: now + windowMs };
        }

        bucket.count += 1;
        return { count: bucket.count, resetAt: bucket.resetAt };
    }

    async reset(key: string): Promise<void> {
        this.buckets.delete(key);
    }

    // For testing
    async get(key: string): Promise<{ count: number; resetAt: number } | undefined> {
        const bucket = this.buckets.get(key);
        if (!bucket || bucket.resetAt < Date.now()) return undefined;
        return { count: bucket.count, resetAt: bucket.resetAt };
    }
}

// Singleton store — replace with Redis implementation for multi-instance deployments
const store: RateLimitStore = new InMemoryRateLimitStore();

export interface RateLimitConfig {
    /** Maximum requests allowed in the window */
    max: number;
    /** Window size in milliseconds */
    windowMs: number;
    /** Optional: custom key prefix (defaults to action name) */
    keyPrefix?: string;
}

/** Default limits per action — tuned for legitimate student usage */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Check-in: 5 attempts per 10 min (matches MAX_CHECKIN_FAILURES + buffer)
    checkin: { max: 5, windowMs: 10 * 60 * 1000, keyPrefix: 'checkin' },
    // Feedback: 1 submission per 5 min (only one allowed anyway, but prevents spam)
    feedback: { max: 2, windowMs: 5 * 60 * 1000, keyPrefix: 'feedback' },
    // Team invitations: 10 per 5 min (leader inviting multiple people)
    invite: { max: 10, windowMs: 5 * 60 * 1000, keyPrefix: 'invite' },
    // Join requests: 5 per 5 min (student requesting to join teams)
    requestJoin: { max: 5, windowMs: 5 * 60 * 1000, keyPrefix: 'requestJoin' },
    // Respond to invites: 20 per 5 min (accepting/rejecting)
    respond: { max: 20, windowMs: 5 * 60 * 1000, keyPrefix: 'respond' },
    // Search students: 30 per minute (typeahead searches)
    searchStudents: { max: 30, windowMs: 60 * 1000, keyPrefix: 'search' },
    // Team operations: 10 per 5 min
    removeMember: { max: 10, windowMs: 5 * 60 * 1000, keyPrefix: 'teamOp' },
    deleteTeam: { max: 5, windowMs: 5 * 60 * 1000, keyPrefix: 'teamOp' },
    // Register: 3 per 10 min (prevents rapid re-registration attempts)
    register: { max: 3, windowMs: 10 * 60 * 1000, keyPrefix: 'register' },
    // Available teams: 20 per minute (browsing)
    availableTeams: { max: 20, windowMs: 60 * 1000, keyPrefix: 'browse' },
};

/**
 * Check rate limit for an action by a user.
 * Returns { allowed: boolean, retryAfterMs?: number, currentCount: number, limit: number, resetAt: number }
 */
export async function checkRateLimit(
    uid: string,
    action: string,
    customConfig?: Partial<RateLimitConfig>
): Promise<{ allowed: boolean; retryAfterMs?: number; currentCount: number; limit: number; resetAt: number }> {
    const baseConfig = DEFAULT_RATE_LIMITS[action];
    if (!baseConfig) {
        // No limit configured for this action — allow
        return { allowed: true, currentCount: 0, limit: Infinity, resetAt: 0 };
    }
    const config = { ...baseConfig, ...customConfig };

    const key = `ratelimit:${config.keyPrefix ?? action}:${uid}`;
    const { count, resetAt } = await store.increment(key, config.windowMs);

    if (count > config.max) {
        const retryAfterMs = Math.max(0, resetAt - Date.now());
        return { allowed: false, retryAfterMs, currentCount: count, limit: config.max, resetAt };
    }

    return { allowed: true, currentCount: count, limit: config.max, resetAt };
}

/**
 * Middleware wrapper for API routes.
 * Adds rate limit headers and returns 429 if exceeded.
 */
export async function withRateLimit(
    request: Request,
    uid: string,
    action: string,
    customConfig?: Partial<RateLimitConfig>
): Promise<{ ok: boolean; response?: Response }> {
    const result = await checkRateLimit(uid, action, customConfig);

    const headers = new Headers();
    headers.set('X-RateLimit-Limit', result.limit.toString());
    headers.set('X-RateLimit-Remaining', Math.max(0, result.limit - result.currentCount).toString());
    headers.set('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
        headers.set('Retry-After', Math.ceil((result.retryAfterMs ?? 0) / 1000).toString());
        return {
            ok: false,
            response: new Response(
                JSON.stringify({
                    error: 'Too many requests. Please wait before trying again.',
                    retryAfterMs: result.retryAfterMs,
                }),
                { status: 429, headers }
            ),
        };
    }

    // Attach headers to request for downstream use (via a symbol or similar pattern)
    // For simplicity, we return the headers to be added by the caller
    return { ok: true, response: new Response(null, { headers }) };
}

/**
 * Extract rate limit headers from the withRateLimit response and apply to a NextResponse.
 */
export function applyRateLimitHeaders(response: Response, rateLimitResponse: Response): void {
    for (const [key, value] of rateLimitResponse.headers.entries()) {
        response.headers.set(key, value);
    }
}

/**
 * Reset rate limit for a user/action (e.g., after admin clears check-in failures).
 */
export async function resetRateLimit(uid: string, action: string): Promise<void> {
    const config = DEFAULT_RATE_LIMITS[action];
    if (!config) return;
    const key = `ratelimit:${config.keyPrefix ?? action}:${uid}`;
    await store.reset(key);
}

// Export store for testing
export { store };