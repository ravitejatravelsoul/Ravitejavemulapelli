import "server-only";
import { SignJWT, jwtVerify } from "jose";

/**
 * A separate, project-scoped, short-lived token for the owner-facing
 * preview route — NOT the session cookie.
 *
 * The preview iframe is deliberately `sandbox="allow-scripts"` *without*
 * `allow-same-origin` (see app/office/preview/[projectId]/[...path]/route.ts
 * and components/ai-office/workspace/preview-panel.tsx), which gives the
 * framed document an opaque origin. An opaque-origin browsing context
 * cannot send cookies for ANY of its own requests — not the top-level
 * frame navigation, not its own `<link>`/`<script>` subresource fetches —
 * even though every one of those requests is physically same-origin.
 * (Confirmed empirically: with only the session cookie, every preview
 * subresource request 307-redirected to /office/login with no cookie
 * header attached at all, once Next's dev route cache stopped masking
 * it.) Adding `allow-same-origin` would fix that, but it would also hand
 * the framed (untrusted, model-generated) content the app's real origin
 * — full access to cookies/localStorage and the ability to script
 * against the parent — defeating the entire reason for sandboxing it in
 * the first place.
 *
 * Instead: the already-authenticated project detail page (a Server
 * Component that already called `verifySession()`) mints a short-lived,
 * project-scoped token and embeds it in the iframe's initial URL as a
 * query parameter. The route handler accepts EITHER a valid session
 * cookie (for someone opening the preview URL directly, unsandboxed) OR
 * a valid token for that exact project (for the sandboxed iframe case).
 * Because the served `index.html` is rewritten to append the same token
 * to every local relative `href`/`src` it contains
 * (rewriteLocalResourceLinks in the route handler), the browser's own
 * follow-up requests for styles.css/script.js carry it too — no cookie
 * access ever required inside the sandbox.
 */

const encoder = new TextEncoder();
const MIN_SECRET_BYTES = 32;
const PREVIEW_TOKEN_TTL = "15m";

function getSecretKey(): Uint8Array | null {
  const secret = process.env.OFFICE_SESSION_SECRET;
  if (!secret) return null;
  const keyBytes = encoder.encode(secret);
  if (keyBytes.length < MIN_SECRET_BYTES) return null;
  return keyBytes;
}

/** Returns null when OFFICE_SESSION_SECRET is unset/too weak — fails closed, exactly like signSessionToken. */
export async function signPreviewToken(projectId: string): Promise<string | null> {
  const key = getSecretKey();
  if (!key) return null;

  return new SignJWT({ projectId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(PREVIEW_TOKEN_TTL)
    .sign(key);
}

/** True only if `token` is a validly-signed, unexpired preview token scoped to exactly this `projectId` — never valid for a different project. */
export async function verifyPreviewToken(token: string, projectId: string): Promise<boolean> {
  const key = getSecretKey();
  if (!key) return false;

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return payload.projectId === projectId;
  } catch {
    return false;
  }
}
