import { NextRequest, NextResponse } from "next/server";

// Sets the Content-Security-Policy with a fresh nonce per request. Next.js reads the nonce
// from the request header and adds it to its own scripts, so no 'unsafe-inline' is needed
// for scripts. 'strict-dynamic' lets those scripts load Firebase's Google scripts.
export function proxy(request: NextRequest) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const isDev = process.env.NODE_ENV === "development";

    const csp = [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://apis.google.com https://www.googletagmanager.com${isDev ? " 'unsafe-eval'" : ""}`,
        // React style attributes need 'unsafe-inline'; a nonce here would switch it off.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://lh3.googleusercontent.com https://images.unsplash.com https://www.google-analytics.com https://www.googletagmanager.com",
        "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebase.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
        `frame-src https://${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}`,
        "object-src 'none'",
        "base-uri 'self'",
    ].join("; ");

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
}

export const config = {
    matcher: [
        {
            source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
            missing: [
                { type: "header", key: "next-router-prefetch" },
                { type: "header", key: "purpose", value: "prefetch" },
            ],
        },
    ],
};
