import { NextResponse, type NextRequest } from "next/server";
import { OFFICE_SESSION_COOKIE } from "@/lib/ai-office/auth/session";
import { verifySessionToken } from "@/lib/ai-office/auth/token";

/**
 * Optimistic auth check for the private AI Office workspace only — every
 * other route on this portfolio is untouched. This is the Next.js 16
 * replacement for `middleware.ts` (renamed "Proxy," same mechanism; see
 * docs/ai-office/02-current-portfolio-assessment.md §1).
 *
 * Per docs/ai-office/08-security-plan.md §2, this is a redirect-latency
 * optimization only — it decrypts the cookie and redirects, nothing more.
 * The real authorization boundary is `verifySession()` in
 * lib/ai-office/auth/dal.ts, called again by the protected layout, every
 * Server Action, and every Route Handler under `/office/**`. Never treat a
 * pass through this proxy as proof of anything on its own.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(OFFICE_SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname === "/office/login") {
    // Already signed in — no reason to show the login form again.
    if (session) {
      return NextResponse.redirect(new URL("/office", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    return NextResponse.redirect(new URL("/office/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/office/:path*"],
};
