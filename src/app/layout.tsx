import type { Metadata } from "next";
import { connection } from "next/server";
import { Outfit, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { APP_METADATA } from "@/lib/constants";
import Providers from "./providers";


const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space" });

export const metadata: Metadata = {
    metadataBase: new URL(APP_METADATA.SITE_URL),
    title: {
        template: "%s | ReLU",
        default: "ReLU | AI/ML and DSA Student Club, Amrita Amaravathi",
    },
    description: APP_METADATA.SITE_DESCRIPTION,
    keywords: ["AI", "Machine Learning", "Student Club", "ReLU", "Deep Learning", "Tech Community"],
    authors: [{ name: "ReLU Tech Team" }],
    openGraph: {
        title: APP_METADATA.SITE_NAME,
        description: "The AI/ML and DSA student club at Amrita Vishwa Vidyapeetham, Amaravathi. Workshops, hackathons and talks.",
        url: APP_METADATA.SITE_URL,
        siteName: "ReLU",
        images: [
            {
                url: "/images/hero-logo.png",
                width: 800,
                height: 600,
            },
        ],
        locale: "en_US",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "ReLU - AI&ML Club",
        description: "Refining Logic and Unleashing AI.",
        images: ["/images/hero-logo.png"],
    },
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // Render every page per request so the CSP nonce from proxy.ts can be applied.
    await connection();
    return (
        <html lang="en">
            <head>
            </head>
            <body className={`${outfit.variable} ${spaceGrotesk.variable} font-sans`}>
                <Providers>
                    {children}
                </Providers>
            </body>
        </html>
    );
}
