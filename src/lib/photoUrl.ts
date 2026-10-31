// Normalize photoURL from Firestore.
// Firestore may store photoURL as:
// - A plain string (correct format)
// - An object { url: string }
// - A JSON-serialized string "{\"url\":\"...\"}" (legacy bug from earlier uploads)
// This function always returns a plain string.
export function normalizePhotoURL(
    photoURL: string | { url: string } | undefined | null
): string {
    if (!photoURL) return '';
    
    // Case 1: Already a plain string
    if (typeof photoURL === 'string') {
        // Case 1a: JSON-serialized object (legacy bug)
        if (photoURL.startsWith('{') && photoURL.includes('"url"')) {
            try {
                const parsed = JSON.parse(photoURL);
                if (parsed && typeof parsed.url === 'string') {
                    return parsed.url;
                }
            } catch {
                // If parsing fails, return as-is
            }
        }
        return photoURL;
    }
    
    // Case 2: Object with url property
    if (typeof photoURL === 'object' && 'url' in photoURL) {
        return (photoURL as { url: string }).url;
    }
    
    return '';
}