// Edge middleware — Doc 2 §6.1.
//
// Redirects anonymous traffic (no Better Auth session cookie) on
// authenticated surfaces to /login?from=<original>. We can't run drizzle
// here (edge runtime, no pg client), so the check is intentionally cheap:
// presence of any `better-auth.session_token` cookie value. Server-side
// route handlers still re-validate the session via auth.api.getSession on
// the node runtime — middleware is only the early-bird redirect.
//
// Intentionally NOT matched:
//   - /api/auth/*       — Better Auth's own surfaces.
//   - /api/published-authz — Caddy forward_auth backend (must respond
//                            even for anonymous so Caddy can route them).
//   - public auth pages — /login, /signup, /forgot-password,
//                          /reset-password, /verify-email,
//                          /auth/account-conflict, /auth/oauth-error.
//   - all /_next/* and static assets.

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/auth/account-conflict",
  "/auth/oauth-error",
]);

const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/published-authz",
  "/_next/",
  "/favicon.ico",
];

const isPublic = (path: string): boolean => {
  if (PUBLIC_PATHS.has(path)) return true;
  for (const p of PUBLIC_PREFIXES) {
    if (path === p || path.startsWith(p)) return true;
  }
  return false;
};

const hasSessionCookie = (req: NextRequest): boolean => {
  // Better Auth sets `better-auth.session_token` on signin. Anything else
  // is just informational (CSRF state, dismissals); we only gate on the
  // session cookie itself.
  const c = req.cookies.get("better-auth.session_token");
  return Boolean(c?.value && c.value.length > 0);
};

export const middleware = (req: NextRequest): NextResponse => {
  const path = req.nextUrl.pathname;
  if (isPublic(path)) return NextResponse.next();
  if (hasSessionCookie(req)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", path);
  return NextResponse.redirect(url);
};

export const config = {
  // Run middleware on every path EXCEPT static asset routes that the
  // matcher list explicitly skips. The runtime check above still catches
  // anything that slips through (cheap doublework).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/published-authz).*)",
  ],
};
