"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /admin/events/lifecycle now redirects to /admin/events.
 * /admin/events is the canonical event-management page; it combines event
 * CRUD with Registration/Attendance/Feedback workflow lifecycle controls
 * (start, stop, restart, reset) so there is a single source of truth.
 */
export default function LifecycleRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/admin/events");
    }, [router]);

    return null;
}
