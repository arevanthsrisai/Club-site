"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import MobileRestriction from "./MobileRestriction";
import Sidebar from "./Sidebar";

// Client shell for the admin area: signed-out pages (login/signup) and the
// pre-auth login form render centered and full-width without the dashboard
// chrome; signed-in pages get the Sidebar + scrollable content column.
export default function AdminShell({ children }: { children: React.ReactNode }) {
    const { user, profile, loading } = useAuth();
    const pathname = usePathname();

    const isAuthPage = pathname === "/admin/login" || pathname === "/admin/signup";
    const chromeVisible = !isAuthPage && !!user;

    return (
        <>
            <MobileRestriction />

            {chromeVisible && profile && !loading ? (
                <div className="hidden md:flex min-h-screen bg-[#0a0a0a] text-white">
                    <Sidebar />
                    <main className="flex-1 p-8 overflow-y-auto h-screen">{children}</main>
                </div>
            ) : (
                <div className="min-h-screen bg-[#0a0a0a] text-white">{children}</div>
            )}
        </>
    );
}
