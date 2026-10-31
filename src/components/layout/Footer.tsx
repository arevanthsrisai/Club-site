"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Linkedin, Instagram, MapPin, Mail } from "lucide-react";

export default function Footer() {
    const pathname = usePathname();
    // Footer appears on every page except the home page (and the admin app,
    // which has its own chrome and never renders this component anyway).
    const isHidden = pathname === "/" || pathname.startsWith("/admin");

    if (isHidden) return null;

    return (
        <footer className="relative z-10 bg-black/80 backdrop-blur-md border-t border-white/10 pt-16 pb-8 mt-auto">
            <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                {/* Brand Column */}
                <div className="col-span-1 md:col-span-2">
                    <Link href="/" className="inline-block mb-6">
                        <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
                            ReLU Club
                        </h2>
                    </Link>
                    <p className="text-gray-400 text-lg leading-relaxed max-w-md mb-6">
                        Refining Logic and Unleashing AI. The AI/ML and DSA student club at Amrita Vishwa Vidyapeetham, Amaravathi. We run workshops, talks and coding events for students.
                    </p>
                    <div className="flex gap-4">
                        <SocialLink href="https://www.linkedin.com/company/reluavv/" icon={<Linkedin size={20} />} label="LinkedIn" />
                        <SocialLink href="https://www.instagram.com/relu_avv/" icon={<Instagram size={20} />} label="Instagram" />
                    </div>
                </div>

                {/* Quick Links */}
                <div>
                    <h3 className="text-white font-semibold text-lg mb-6 relative inline-block after:content-[''] after:absolute after:-bottom-2 after:left-0 after:w-12 after:h-1 after:bg-blue-500 rounded-full">
                        Quick Links
                    </h3>
                    <ul className="space-y-4">
                        <FooterLink href="/about" label="Team" />
                        <FooterLink href="/events" label="Events" />
                        <FooterLink href="/resources" label="Resources" />
                        <FooterLink href="/alumni" label="Alumni" />
                        <FooterLink href="/contact" label="Contact" />
                    </ul>
                    <ul className="mt-6 pt-6 border-t border-white/5 space-y-4">
                        <FooterLink href="/privacy" label="Privacy Policy" />
                        <FooterLink href="/terms" label="Terms of Service" />
                    </ul>
                </div>

                {/* Contact Info */}
                <div>
                    <h3 className="text-white font-semibold text-lg mb-6 relative inline-block after:content-[''] after:absolute after:-bottom-2 after:left-0 after:w-12 after:h-1 after:bg-purple-500 rounded-full">
                        Contact
                    </h3>
                    <ul className="space-y-4 text-gray-400">
                        <li className="flex items-start gap-3">
                            <MapPin className="mt-1.5 text-blue-400" size={18} />
                            <span>Amrita Vishwa Vidyapeetham, Amaravathi Campus</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <Mail className="text-blue-400 mt-1" size={18} />
                            <div className="flex flex-col gap-1">
                                <a href="mailto:reluavv@gmail.com" className="hover:text-blue-400 transition-colors">
                                    reluavv@gmail.com
                                </a>
                                <a href="mailto:reluclub@av.amrita.edu" className="hover:text-blue-400 transition-colors">
                                    reluclub@av.amrita.edu
                                </a>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>

            {/* Bottom Bar */}
            <div className="max-w-7xl mx-auto px-6 pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 text-gray-500 text-sm">
                <p>&copy; {new Date().getFullYear()} ReLU Club. All rights reserved.</p>
                <div className="flex items-center gap-6">
                    <a href="https://www.linkedin.com/company/reluavv/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">LinkedIn</a>
                    <a href="https://www.instagram.com/relu_avv/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Instagram</a>
                </div>
            </div>
        </footer>
    );
}

function SocialLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-blue-600 hover:border-blue-500 transition-all duration-300 transform hover:-translate-y-1"
        >
            {icon}
        </a>
    );
}

function FooterLink({ href, label }: { href: string; label: string }) {
    return (
        <li>
            <Link href={href} className="text-gray-400 hover:text-blue-400 hover:translate-x-1 transition-all inline-block">
                {label}
            </Link>
        </li>
    );
}
