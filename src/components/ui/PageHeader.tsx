import React from "react";

/**
 * Shared admin page header. Keeps every tab's title block, subtitle and
 * primary action aligned on one baseline with identical spacing.
 */
export default function PageHeader({
    title,
    subtitle,
    icon,
    actions,
}: {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
}) {
    return (
        <div className="flex justify-between items-end gap-4 mb-8 border-b border-white/10 pb-6">
            <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
                    {icon && <span className="text-blue-500 shrink-0">{icon}</span>}
                    <span className="truncate">{title}</span>
                </h1>
                {subtitle && <p className="text-gray-400 mt-1.5 text-sm md:text-base">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
    );
}
