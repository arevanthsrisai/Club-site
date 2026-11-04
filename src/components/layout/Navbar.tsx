"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/firebase"; // Import db
import { doc, onSnapshot } from "firebase/firestore"; // Import Firestore functions
import {
    Home,
    Users,
    Megaphone,
    Bot,
    Code,
    Book,
    Mail,
    Menu,
    X,
    ChevronDown,
    Shield,
    GraduationCap,
    History,
} from "lucide-react";
import NotificationBell from "@/components/public/NotificationBell";

export default function Navbar() {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [resourcesOpen, setResourcesOpen] = useState(false);

    // State for public user profile (avatar)
    const [publicAvatar, setPublicAvatar] = useState<string | null>(null);

    // Close mobile menu on route change
    useEffect(() => {
        setMobileMenuOpen(false);
        setResourcesOpen(false);
    }, [pathname]);

    const toggleMenu = () => setMobileMenuOpen(!mobileMenuOpen);

    const navItems = [
        { name: "Home", path: "/", icon: Home },
        { name: "About", path: "/about", icon: Users },
        { name: "Ex-Core", path: "/ex-core", icon: History },
        { name: "Events", path: "/events", icon: Megaphone },
        { name: "Alumni", path: "/alumni", icon: GraduationCap },
        // AIML and DSA moved to Resources dropdown
    ];
    const contactItem = { name: "Contact", path: "/contact", icon: Mail };

    const resourceItems = [
        { name: "All Resources", path: "/resources", icon: Book },
        { name: "AI/ML", path: "/resources?category=AIML", icon: Bot },
        { name: "DSA", path: "/resources?category=DSA", icon: Code },
    ];

    const { user, profile } = useAuth(); // Get auth state

    // Listen to public profile changes (for avatar)
    useEffect(() => {
        if (user && !profile) {
            const unsub = onSnapshot(doc(db, "users", user.uid), (doc) => {
                const data = doc.data();
                if (data?.photoURL) {
                    setPublicAvatar(data.photoURL);
                } else {
                    setPublicAvatar(null);
                }
            });
            return () => unsub();
        } else {
            setPublicAvatar(null);
        }
    }, [user, profile]);

    return (
        <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4">
            {/* Mobile Menu Overlay */}
            <div
                className={`nav-overlay ${mobileMenuOpen ? "active" : ""}`}
                onClick={() => setMobileMenuOpen(false)}
            />

            {/* Floating Desktop Nav / Mobile Container */}
            <nav className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-full px-6 py-3 shadow-[0_0_20px_rgba(0,0,0,0.5)]">

                <div className="flex items-center justify-between md:justify-center gap-8">
                    {/* Desktop Links */}
                    <div className="hidden md:flex items-center gap-1">
                        {/* Standard Items (includes Alumni) */}
                        {navItems.map((item) => (
                            <Link
                                key={item.path}
                                href={item.path}
                                className={`
                                    relative px-4 py-2 rounded-full text-sm font-medium transition-all duration-300
                                    hover:bg-white/10 hover:text-white
                                    ${pathname === item.path ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25" : "text-gray-400"}
                                `}
                            >
                                <span className="flex items-center gap-2">
                                    {item.name}
                                </span>
                            </Link>
                        ))}

                        {/* Resources Dropdown */}
                        <div
                            className="relative group"
                            onMouseEnter={() => setResourcesOpen(true)}
                            onMouseLeave={() => setResourcesOpen(false)}
                            onKeyDown={(e) => e.key === "Escape" && setResourcesOpen(false)}
                        >
                            <button
                                type="button"
                                onClick={() => setResourcesOpen((open) => !open)}
                                aria-expanded={resourcesOpen}
                                aria-controls="resources-menu"
                                className={`
                                    relative px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 flex items-center gap-2
                                    hover:bg-white/10 hover:text-white
                                    ${pathname.startsWith("/resources") ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25" : "text-gray-400"}
                                `}
                            >
                                <Book size={16} />
                                Resources
                                <ChevronDown size={14} className={`transition-transform duration-300 ${resourcesOpen ? "rotate-180" : ""}`} />
                            </button>

                            {/* Dropdown Menu */}
                            <div id="resources-menu" className={`
                                absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-48 
                                bg-[#0a0a0a] border border-white/10 rounded-xl overflow-hidden shadow-2xl 
                                transition-all duration-300 origin-top
                                ${resourcesOpen ? "opacity-100 scale-100 translate-y-0 visible" : "opacity-0 scale-95 -translate-y-2 invisible"}
                            `}>
                                {resourceItems.map((item) => (
                                    <Link
                                        key={item.path}
                                        href={item.path}
                                        className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-gray-400 hover:text-white transition-colors text-sm"
                                    >
                                        <item.icon size={14} />
                                        {item.name}
                                    </Link>
                                ))}
                            </div>
                        </div>

                        {/* Contact */}
                        <Link
                            href={contactItem.path}
                            className={`
                                relative px-4 py-2 rounded-full text-sm font-medium transition-all duration-300
                                hover:bg-white/10 hover:text-white
                                ${pathname === contactItem.path ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25" : "text-gray-400"}
                            `}
                        >
                            <span className="flex items-center gap-2">
                                {contactItem.name}
                            </span>
                        </Link>

                        {/* Notification Bell (Desktop) */}
                        {user && !profile && (
                            <div className="mr-2">
                                <NotificationBell />
                            </div>
                        )}

                        {/* AUTH SECTION (Desktop) */}
                        <div className="w-px h-6 bg-white/10 mx-2" />

                        {user ? (
                            !profile ? (
                                <Link
                                    href="/profile"
                                    className={`
                                        flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-full transition-all duration-300
                                        hover:bg-white/10 border border-transparent hover:border-white/10
                                        ${pathname === '/profile' ? "bg-white/10 border-white/20" : ""}
                                    `}
                                    title="My Profile"
                                >
                                    {publicAvatar ? (
                                        <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 shadow-lg">
                                            <Image
                                                src={publicAvatar}
                                                alt="Profile"
                                                width={32}
                                                height={32}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-lg">
                                            {user.email?.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                </Link>
                            ) : (
                                <Link
                                    href="/admin"
                                    className="px-4 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition-colors border border-white/10"
                                >
                                    Admin Dashboard
                                </Link>
                            )
                        ) : (
                            <Link
                                href="/auth/login"
                                className="px-5 py-2 rounded-full text-sm font-bold bg-white text-black hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)]"
                            >
                                Sign In
                            </Link>
                        )}
                    </div>

                    {/* Mobile Toggle */}
                    <div className="md:hidden flex items-center justify-between w-full min-w-[300px]">
                        <span className="font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600 transition-all duration-300 hover:from-cyan-300 hover:to-purple-400">ReLU</span>

                        <div className="flex items-center gap-4">
                            {/* Notification Bell (Mobile) - Visible when logged in */}
                            {!mobileMenuOpen && (
                                <NotificationBell />
                            )}

                            {/* Mobile Profile Icon (Visible when menu closed too) */}
                            {user && !mobileMenuOpen && (
                                <Link
                                    href="/profile"
                                    className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-lg overflow-hidden"
                                >
                                    {publicAvatar ? (
                                        <Image
                                            src={publicAvatar}
                                            alt="Profile"
                                            width={32}
                                            height={32}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        profile?.displayName?.charAt(0) || user.email?.charAt(0).toUpperCase()
                                    )}
                                </Link>
                            )}

                            <button
                                onClick={toggleMenu}
                                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                                aria-expanded={mobileMenuOpen}
                                className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-full text-white"
                            >
                                {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mobile Dropdown Menu */}
                {mobileMenuOpen && (
                    <div className="absolute top-full left-0 right-0 mt-4 mx-4 bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl p-4 flex flex-col gap-2 md:hidden animate-in slide-in-from-top-5">

                        {/* Auth Status Mobile */}
                        {user ? (
                            !profile ? (
                                <Link
                                    href="/profile"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-center gap-4 px-4 py-4 mb-2 bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-white/10 rounded-xl"
                                >
                                    {publicAvatar ? (
                                        <div className="w-10 h-10 rounded-full overflow-hidden shadow-lg border border-white/10">
                                            <Image
                                                src={publicAvatar}
                                                alt="Profile"
                                                width={40}
                                                height={40}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                                            {user.email?.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div>
                                        <p className="font-bold text-white">Your Profile</p>
                                        <p className="text-xs text-blue-300">View & Edit</p>
                                    </div>
                                </Link>
                            ) : (
                                <Link
                                    href="/admin"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-center gap-4 px-4 py-4 mb-2 bg-white/5 border border-white/10 rounded-xl"
                                >
                                    <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold text-sm">
                                        <Shield size={20} />
                                    </div>
                                    <div>
                                        <p className="font-bold text-white">{profile.displayName}</p>
                                        <p className="text-xs text-gray-400">Go to Dashboard</p>
                                    </div>
                                </Link>
                            )
                        ) : (
                            <Link
                                href="/auth/login"
                                onClick={() => setMobileMenuOpen(false)}
                                className="w-full py-3 bg-white text-black font-bold rounded-xl text-center mb-4 shadow-lg hover:bg-gray-200 transition-colors"
                            >
                                Sign In / Join
                            </Link>
                        )}

                        {/* ... standard items ... */}
                        {/* Standard Items (includes Alumni) */}
                        {navItems.map((item) => (
                            <Link
                                key={item.path}
                                href={item.path}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`
                                    flex items-center gap-4 px-4 py-3 rounded-xl transition-colors
                                    ${pathname === item.path ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:bg-white/5 hover:text-white"}
                                `}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${pathname === item.path ? "bg-blue-600 text-white" : "bg-white/10"}`}>
                                    <item.icon size={16} />
                                </div>
                                <span className="font-medium">{item.name}</span>
                            </Link>
                        ))}

                        {/* Resources Accordion (Always expanded for simplicity or togglable) */}
                        <div className="border-t border-white/10 pt-2 mt-2">
                            <p className="px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">Resources</p>
                            {resourceItems.map((item) => (
                                <Link
                                    key={item.path}
                                    href={item.path}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className={`
                                    flex items-center gap-4 px-4 py-3 rounded-xl transition-colors
                                    ${pathname === item.path || pathname === item.path.split('?')[0] && item.path !== '/resources' ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:bg-white/5 hover:text-white"}
                                `}
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${pathname === item.path ? "bg-blue-600 text-white" : "bg-white/10"}`}>
                                        <item.icon size={16} />
                                    </div>
                                    <span className="font-medium">{item.name}</span>
                                </Link>
                            ))}
                        </div>

                        {/* Contact */}
                        <div className="border-t border-white/10 pt-2 mt-2">
                            <Link
                                href={contactItem.path}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`
                                    flex items-center gap-4 px-4 py-3 rounded-xl transition-colors
                                    ${pathname === contactItem.path ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:bg-white/5 hover:text-white"}
                                `}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${pathname === contactItem.path ? "bg-blue-600 text-white" : "bg-white/10"}`}>
                                    <Mail size={16} />
                                </div>
                                <span className="font-medium">{contactItem.name}</span>
                            </Link>
                        </div>
                    </div>
                )}
            </nav>
        </div>
    );
}
