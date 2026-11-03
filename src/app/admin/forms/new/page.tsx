"use client";

/**
 * Redirect /admin/forms/new to /admin/events/new.
 *
 * Forms are now event-scoped. Admins create events, and the system
 * automatically provides Registration, Attendance, and Feedback workflows.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NewFormRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/admin/events/new");
    }, [router]);
    return (
        <div className="flex items-center justify-center min-h-[50vh]">
            <p className="text-gray-400">Redirecting to Events → New…</p>
        </div>
    );
}
