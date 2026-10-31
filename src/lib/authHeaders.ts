/**
 * Client-side Auth Header Utilities
 * 
 * These functions run in the browser to get Firebase Auth tokens
 * for making authenticated API requests. They do NOT import firebase-admin.
 */

/**
 * Helper to get the current user's ID token on the client side.
 * Call this before making authenticated API requests.
 * 
 * Usage (client-side):
 *   import { getAuthToken } from '@/lib/authHeaders';
 *   const token = await getAuthToken();
 *   fetch('/api/endpoint', { headers: { Authorization: `Bearer ${token}` } });
 */
export async function getAuthToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;

    try {
        const { auth } = await import('@/lib/firebase');
        const user = auth.currentUser;
        if (!user) return null;
        return await user.getIdToken();
    } catch (error) {
        console.error('Failed to get auth token:', error);
        return null;
    }
}

/**
 * Creates the Authorization header object for authenticated API calls.
 * Returns null if no user is logged in.
 * 
 * Usage (client-side):
 *   const authHeaders = await getAuthHeaders();
 *   if (!authHeaders) { handle unauthorized }
 *   fetch('/api/endpoint', { headers: { 'Content-Type': 'application/json', ...authHeaders } });
 */
export async function getAuthHeaders(): Promise<Record<string, string> | null> {
    const token = await getAuthToken();
    if (!token) return null;
    return { Authorization: `Bearer ${token}` };
}
