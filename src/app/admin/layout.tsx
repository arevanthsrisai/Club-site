import type { Metadata } from "next";
import AdminGuard from "@/components/admin/AdminGuard";
import AdminShell from "@/components/admin/AdminShell";

export const metadata: Metadata = {
    title: { absolute: "ReLU Admin", template: "%s | ReLU Admin" },
    robots: { index: false, follow: false },
};

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AdminGuard>
            <AdminShell>{children}</AdminShell>
        </AdminGuard>
    );
}
