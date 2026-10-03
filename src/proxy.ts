import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Protected-first: everything requires a session except the auth pages and
 * the Clerk webhook endpoint. If Clerk env vars are missing (setup mode),
 * requests pass through so the in-app setup screens can render.
 */
const isPublicRoute = createRouteMatcher([
  "/login(.*)",
  "/signup(.*)",
  "/api/webhooks/clerk(.*)",
]);

const clerkNotConfigured =
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY;

export default clerkMiddleware(async (auth, req) => {
  if (clerkNotConfigured) return NextResponse.next();
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // run on everything except static files & Next internals
    "/((?!_next|[^?]*\\.[^!/]+$).*)",
    "/(api|trpc)(.*)",
  ],
};
