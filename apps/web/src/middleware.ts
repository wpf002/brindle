import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers, chiefly a nonce-based Content-Security-Policy.
 *
 * The session token now lives in an httpOnly cookie, so page JS can't read it —
 * but an injected script could still act as the signed-in user, since the
 * browser attaches that cookie to whatever the page asks for. A CSP is what
 * stops injected script from running in the first place.
 *
 * Nonce-based rather than a host allowlist: Next.js emits its own inline
 * bootstrap scripts, and 'unsafe-inline' would defeat the purpose. Next reads
 * the nonce out of the CSP header on the request and stamps it onto every
 * script it renders. `strict-dynamic` then lets those scripts load the chunks
 * they need without us enumerating paths.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const ws = api.replace(/^http/, "ws");
  const media = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "";
  const dev = process.env.NODE_ENV !== "production";

  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' is required by the dev-mode React refresh runtime and is
    // never emitted in a production build.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${dev ? "'unsafe-eval'" : ""}`,
    // Inline style *attributes* (style={{…}}) are used throughout the UI.
    // Injected CSS is a far smaller problem than injected script, and locking
    // this down would mean rewriting every component's layout styles.
    "style-src 'self' 'unsafe-inline'",
    // next/font self-hosts its files, so no external font origin is needed.
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${media}`.trim(),
    `media-src 'self' blob: ${media}`.trim(),
    // XHR/WebSocket to the API, plus presigned PUTs straight to object storage.
    `connect-src 'self' ${api} ${ws} ${media} https://*.amazonaws.com https://*.r2.cloudflarestorage.com`.trim(),
    "frame-ancestors 'none'", // nothing embeds a live bidding page in an iframe
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ];

  const csp = directives.join("; ").replace(/\s{2,}/g, " ").trim();

  // Next needs the nonce on the *request* to stamp its own script tags.
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("x-frame-options", "DENY");
  // No page here needs a camera, microphone, or the user's location.
  res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  return res;
}

export const config = {
  matcher: [
    // Everything except static assets and prefetches, which don't execute
    // script and would only pay the cost of losing the static cache.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
