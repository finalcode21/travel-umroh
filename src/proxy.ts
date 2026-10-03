import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware runs in a restricted runtime with no database driver, so it
 * deliberately performs only a cheap, stateless gate: does the request carry
 * a session cookie? Real session validation (expiry, user status, revocation)
 * happens server-side in `requireUser()` on the Node runtime, which every
 * page and server action goes through.
 */

/** Protected-first: everything requires a session except the auth pages. */
const isPublicRoute = /^\/(login|signup|api\/auth|healthz|readyz|robots\.txt|sitemap\.xml)(\/|$)/;

/** Routes that must always be reachable during setup (no auth gate). */
const alwaysPublic = /^\/(api\/(healthz|readyz)|_next|static|favicon\.ico)(\/|$)/;

const SESSION_COOKIE = "tu_session";

function isStaticAsset(pathname: string): boolean {
  return /\.(css|js|ico|png|jpg|jpeg|svg|woff|woff2|ttf|eot|webp|avif|gif)(\?.*)?$/.test(
    pathname,
  );
}

export default function authMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Never gate Next.js internals, assets, or health endpoints.
  if (alwaysPublic.test(pathname) || isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // Public routes: serve directly.
  if (isPublicRoute.test(pathname)) {
    return NextResponse.next();
  }

  // Everything else requires a session cookie.
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except static files & Next internals.
    "/((?!_next|[^?]*\\.[^!/]+$).*)",
    "/(api|trpc)(.*)",
  ],
};