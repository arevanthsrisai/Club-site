/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    // Keep sharp as a runtime dependency (not bundled) so its native binaries
    // are traced/copied verbatim into the standalone output. Bundling sharp
    // drops the platform-specific libvips DLLs, breaking dlopen on Windows.
    serverExternalPackages: ["sharp"],
    outputFileTracingIncludes: {
        "*": [
            "./node_modules/sharp/**/*",
            "./node_modules/@img/**/*",
        ],
    },
    poweredByHeader: false,
    // Stop next dev from writing AGENTS.md into the repo.
    agentRules: false,
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'firebasestorage.googleapis.com',
            },
            {
                protocol: 'https',
                hostname: 'images.unsplash.com',
            },
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
            },
        ],
        // Allow local /api/gallery/media endpoint with key query parameter
        // for serving gallery/profile images from private B2 bucket.
        // Path must match exactly; query string must include 'key'.
        // Allow local public images (from /public/images)
        localPatterns: [
            {
                pathname: '/api/gallery/media',
            },
            {
                pathname: '/images/**',
            },
        ],
    },
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'X-DNS-Prefetch-Control',
                        value: 'on'
                    },
                    {
                        key: 'Strict-Transport-Security',
                        value: 'max-age=63072000; includeSubDomains; preload'
                    },
                    {
                        key: 'X-XSS-Protection',
                        value: '1; mode=block'
                    },
                    {
                        key: 'X-Frame-Options',
                        value: 'SAMEORIGIN'
                    },
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff'
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin'
                    },
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=(), geolocation=()'
                    },
                    // Vercel only hosts the staging copy; keep it out of search results.
                    ...(process.env.VERCEL ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
                ]
            }
        ];
    },
};

export default nextConfig;
