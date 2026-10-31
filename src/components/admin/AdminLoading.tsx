"use client";

import { Loader2 } from "lucide-react";

/**
 * Consistent full-page loader used by all admin route `loading.tsx` files,
 * so navigation shows a stable skeleton instead of a blank flash or jump.
 */
function AdminLoading({ label }: { label: string }) {
    return (
        <div
            className="min-h-[60vh] flex flex-col items-center justify-center gap-4"
            role="status"
            aria-live="polite"
            aria-label={label}
        >
            <Loader2 size={36} className="animate-spin text-blue-500" />
            <p className="text-gray-400 font-mono text-sm animate-pulse">{label}</p>
        </div>
    );
}

export default AdminLoading;
