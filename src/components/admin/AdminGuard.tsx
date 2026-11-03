"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth, signOut } from "@/lib/auth";
import { ShieldAlert, LogOut } from "lucide-react";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { user, profile, loading } = useAuth();

    useEffect(() => {
        if (!loading && !user && pathname !== "/admin/login" && pathname !== "/admin/signup") {
            router.push("/admin/login");
        }

        // Auto-Migrate Legacy Super Admin to CTO (one-shot, with error handling)
        if ((profile?.role as string) === "super_admin") {
            const migrationKey = `relu_migration_${user!.uid}`;
            if (!sessionStorage.getItem(migrationKey)) {
                sessionStorage.setItem(migrationKey, "in_progress");
                import("@/lib/api").then(api => {
                    api.updateAdminRole(user!.uid, "CTO").then(() => {
                        window.location.reload();
                    }).catch((err: Error) => {
                        console.error("Super admin migration failed:", err);
                        sessionStorage.removeItem(migrationKey);
                    });
                });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, loading, pathname, router]);

    // The first-account setup and the super_admin migration only set the role, so a CTO
    // could end up with no status and be left out of every team list.
    useEffect(() => {
        if (user && profile?.role === "CTO" && !profile.status) {
            import("@/lib/api").then(api => api.updateAdminProfileData(user.uid, { status: "active" }))
                .catch((err: Error) => console.error("Could not set CTO status:", err));
        }
    }, [user, profile]);

    // Public auth pages
    const isAuthPage = pathname === "/admin/login" || pathname === "/admin/signup";
    const onboardingAdminOffPage = !!user && profile?.status === "onboarding" && !isAuthPage && pathname !== "/admin/onboarding";
    // Only approved admins bounce off the onboarding page back to the dashboard.
    // Pending accounts may visit /admin/onboarding: it is the Ex-Core self-signup
    // path (the server route there flips "pending" → ExCoreMember and starts
    // onboarding). They still cannot reach the dashboard until they do that or
    // an admin approves them.
    const activeAdminOnOnboarding = !!user && !!profile?.role && profile?.role !== "pending" && profile?.status !== "onboarding" && pathname === "/admin/onboarding";
    // Still-pending accounts may view the onboarding page itself; everything else
    // behind the guard needs an approved role.
    const pendingOnOnboarding = !!user && profile?.role === "pending" && pathname === "/admin/onboarding";

    // Redirects must never run during render: schedule them in an effect and
    // render nothing until they land.
    useEffect(() => {
        if (onboardingAdminOffPage) {
            router.push("/admin/onboarding");
        } else if (activeAdminOnOnboarding) {
            router.push("/admin");
        } else if (isAuthPage && user) {
            router.push("/admin");
        }
    }, [onboardingAdminOffPage, activeAdminOnOnboarding, isAuthPage, user, router, pathname]);

    if (onboardingAdminOffPage || activeAdminOnOnboarding) return null;

    if (isAuthPage) {
        if (user) return null;
        return <>{children}</>;
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black text-white">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!user) return null;

    // Handle Missing Profile (Auto-Setup)
    if (!profile && !loading) {
        return <div className="min-h-screen flex items-center justify-center bg-black text-white">
            <SetupAccount user={user} />
        </div>;
    }

    // Handle Onboarding (redirects already scheduled in the effect above)
    if (profile?.status === "onboarding" || pendingOnOnboarding) {
        return <>{children}</>;
    }

    // Check Role
    if (profile?.role === "pending") {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-4">
                <div className="bg-white/5 border border-white/10 p-8 rounded-xl max-w-md text-center backdrop-blur-sm">
                    <div className="w-16 h-16 bg-yellow-500/20 text-yellow-500 rounded-full flex items-center justify-center mx-auto mb-6">
                        <ShieldAlert size={32} />
                    </div>
                    <h1 className="text-2xl font-bold mb-4">Access Pending</h1>
                    <p className="text-gray-400 mb-8">
                        Your account has been created but requires administrator approval.
                        Please contact the team to activate your access.
                    </p>
                    <div className="flex flex-col gap-3 min-w-[15rem]">
                        <button
                            onClick={() => router.push("/admin/onboarding")}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                        >
                            Continue as Ex-Core Member
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-2 bg-white/5 text-gray-300 hover:text-white rounded-lg transition-colors"
                        >
                            Check Status Again
                        </button>
                        <button
                            onClick={() => signOut().then(() => router.push("/admin/login"))}
                            className="w-full py-2 text-gray-400 hover:text-white flex items-center justify-center gap-2"
                        >
                            <LogOut size={16} /> Sign Out
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Any approved role may enter (pending was handled above). Tenure is enforced by checkTenure() in useAuth().
    if (profile?.role) {
        return <>{children}</>;
    }

    // Default: Access Denied (safe fallback)
    return null;
}

// Internal Component to handle First-Run / Missing Profile Logic
import { useState } from "react";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { createAdminProfile, isSystemInitialized } from "@/lib/api";
import { User } from "firebase/auth";

function SetupAccount({ user }: { user: User }) {
    const [status, setStatus] = useState("idle");
    const [error, setError] = useState("");

    const handleSetup = async () => {
        setStatus("loading");
        try {
            const initialized = await isSystemInitialized();
            const role = initialized ? "pending" : "CTO";

            await createAdminProfile(user.uid, normalizeEmail(user.email) || "");

            // If we just made them CTO (First user), we need to update the role in DB
            if (!initialized) {
                const { updateAdminRole } = await import("@/lib/api");
                await updateAdminRole(user.uid, "CTO");
            }

            window.location.reload(); // Reload to fetch new profile and proceed
        } catch (err) {
            console.error(err);
            setError("Failed to setup account. Please try again.");
            setStatus("idle");
        }
    };

    return (
        <div className="bg-white/5 border border-white/10 p-8 rounded-xl max-w-md text-center backdrop-blur-sm">
            <h1 className="text-2xl font-bold mb-4">Account Setup</h1>
            <p className="text-gray-400 mb-8">
                We need to initialize your admin profile in the database.
            </p>
            {error && <p className="text-red-400 mb-4">{error}</p>}
            <button
                onClick={handleSetup}
                disabled={status === "loading"}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors disabled:opacity-50"
            >
                {status === "loading" ? "Setting up..." : "Initialize Account"}
            </button>
        </div>
    );
}
