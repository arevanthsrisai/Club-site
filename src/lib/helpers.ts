/**
 * Utility helper functions shared across the application.
 */

/**
 * Check that all elements in an array are unique (case-insensitive for strings).
 */
export function allUnique<T extends string | number>(items: T[]): boolean {
  const seen = new Set<string | number>();
  for (const item of items) {
    const key = typeof item === "string" ? item.toLowerCase() : item;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Debounce a function call - only execute after N ms of inactivity.
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Truncate a string to maximum length, adding ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Sleep for N milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}