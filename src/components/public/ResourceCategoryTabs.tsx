"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Bot, Code, Blocks } from "lucide-react";
import { Suspense } from "react";

function CategoryTabs() {
    const searchParams = useSearchParams();
    const category = searchParams.get("category");    const tabs = [
        { label: "AI / ML", value: "AIML", icon: Bot, color: "blue" },
        { label: "DSA", value: "DSA", icon: Code, color: "purple" },
        { label: "General", value: "General", icon: Blocks, color: "green" },
    ];

    return (
        <div className="flex justify-center gap-3 mb-12 flex-wrap px-3">
            {tabs.map((tab) => {
                const isActive = category === tab.value;
                const activeClasses =
                    tab.color === "blue"
                        ? "bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-500/25"
                        : tab.color === "purple"
                          ? "bg-purple-600 text-white border-purple-500 shadow-lg shadow-purple-500/25"
                          : "bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-500/25";
                return (
                    <Link
                        key={tab.value}
                        href={`/resources?category=${tab.value}`}
                        className={
                            `flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all duration-300 border ` +
                            (isActive ? activeClasses : "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white")
                        }
                        aria-current={isActive ? "page" : undefined}
                    >
                        <tab.icon size={16} />
                        {tab.label}
                    </Link>
                );
            })}
        </div>
    );
}

export default function ResourceCategoryTabs() {
    return (
        <Suspense fallback={<div className="flex justify-center gap-3 mb-12"><div className="h-12" /></div>}>
            <CategoryTabs />
        </Suspense>
    );
}
