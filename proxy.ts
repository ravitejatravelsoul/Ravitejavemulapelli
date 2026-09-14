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

  // The preview route accepts EITHER the session cookie OR a short-lived,
  // project-scoped `?token=` query param (lib/ai-office/auth/preview-token.ts)
  // — required because its content is loaded inside a sandboxed
  // `allow-scripts`-only iframe, whose opaque origin never sends cookies
  // for any of its own requests (top-level frame nav or subresource
  // fetches alike), even though the session cookie exists in the browser.
  // This proxy only ever knows about cookies, so it cannot evaluate that
  // token itself — deferring entirely to the route handler's own
  // `verifySession() || verifyPreviewToken()` check (which correctly
  // returns a 401 JSON on failure, not a login-page redirect that would
  // be nonsensical as the body of a <script>/<link> subresource anyway).
  if (pathname.startsWith("/office/preview/")) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(OFFICE_SESSION_COOKIE)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;

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
