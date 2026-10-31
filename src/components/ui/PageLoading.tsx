import { Loader2 } from "lucide-react";

// Route-level public loading state: centered spinner consistent with the site theme.
// Rendered inside the public layout, so Navbar/Footer stay visible while loading.
export default function PageLoading() {
    return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 relative z-10">
            <div className="p-1 rounded-full bg-gradient-to-tr from-blue-600 to-purple-600 animate-spin">
                <Loader2 size={28} className="animate-[spin_0.8s_linear_reverse] text-white" aria-hidden="true" />
            </div>
            <p className="text-gray-400 text-sm animate-pulse" role="status">Loading…</p>
        </div>
    );
}
