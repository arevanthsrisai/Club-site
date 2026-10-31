"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Global navigation progress: a 2px gradient bar fixed at the top of the viewport.
//
// Usage: mounted once in the root Providers. It listens for same-origin link
// clicks and popstate (browser Back/Forward), then shows the bar only if the
// navigation takes longer than SHOW_DELAY_MS, so fast client-side transitions
// (the common case) never flash. When the pathname settles, the bar runs to 100%
// and fades out. Reduced-motion users still get the (non-animated) feedback;
// globals.css disables decorative animation globally.
//
// The bar never claims to be finished until the route actually changes or the
// fail-safe timer fires, so interrupted or slow requests never leave a stuck bar.

const SHOW_DELAY_MS = 120;
const COMPLETE_MS = 250;
const CRAWL_MS = 90;
const MAX_WIDTH = 92;

export default function NavigationProgress() {
    const pathname = usePathname();
    const [visible, setVisible] = useState(false);
    const [width, setWidth] = useState(0);

    const active = useRef(false);
    const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const crawlTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const failSafe = useRef<ReturnType<typeof setTimeout> | null>(null);

    const finish = useCallback(() => {
        if (!active.current) return;
        clearAll();
        setWidth(100);
        hideTimer.current = setTimeout(() => {
            setVisible(false);
            // Reset width after the fade-out so the next run starts fresh.
            setWidth(0);
            active.current = false;
        }, COMPLETE_MS);
    }, []);

    const start = useCallback(() => {
        if (active.current) return;
        active.current = true;
        setWidth(4);
        // Never flash the bar for quick navigations.
        showTimer.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
        crawlTimer.current = setInterval(() => {
            setWidth((w) => Math.min(MAX_WIDTH, w + 2.5));
        }, CRAWL_MS);
        // Fail-safe: if the route never changes (e.g. navigation cancelled),
        // finish anyway so the bar can't get stuck.
        failSafe.current = setTimeout(() => finish(), 10000);
    }, [finish]);

    const clearAll = () => {
        if (showTimer.current) clearTimeout(showTimer.current);
        if (crawlTimer.current) clearInterval(crawlTimer.current);
        if (failSafe.current) clearTimeout(failSafe.current);
        showTimer.current = null;
        crawlTimer.current = null;
        failSafe.current = null;
    };

    // Complete the bar whenever the pathname settles (client navigation,
    // programmatic navigation, and full-page loads that mount a new tree).
    useEffect(() => {
        if (active.current) finish();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
            const href = anchor.getAttribute("href") || "";
            if (href.startsWith("#")) return;
            // External links do their own loading; same-page anchors don't navigate.
            if (anchor.origin && anchor.origin !== window.location.origin) return;
            if (anchor.pathname === window.location.pathname && !anchor.search && !anchor.hash) return;
            start();
        };
        const onPopState = () => start();

        document.addEventListener("click", onClick, true);
        window.addEventListener("popstate", onPopState);
        return () => {
            document.removeEventListener("click", onClick, true);
            window.removeEventListener("popstate", onPopState);
        };
    }, [start]);

    // Unmount cleanup so timers never leak.
    useEffect(() => {
        return () => {
            clearAll();
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, []);

    return (
        <div
            aria-hidden="true"
            className={`fixed top-0 left-0 right-0 z-[200] h-0.5 pointer-events-none transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
        >
            <div
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                style={{ width: `${width}%`, transition: "width 0.25s ease-out" }}
            />
        </div>
    );
}
