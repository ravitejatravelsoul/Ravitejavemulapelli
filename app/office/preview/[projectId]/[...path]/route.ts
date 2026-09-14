import { NextResponse } from "next/server";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { verifyPreviewToken } from "@/lib/ai-office/auth/preview-token";
import { readFile, workspaceExists, WorkspacePathError, getContentType } from "@/lib/ai-office/workspace/workspace-service";
import { rewriteLocalResourceLinks } from "@/lib/ai-office/workspace/rewrite-preview-links";

// Never statically cached — every response depends on a session/token
// check that must run on every request.
export const dynamic = "force-dynamic";

/**
 * Owner-only preview of a project's real workspace files. Deliberately a
 * session-gated Route Handler rather than a spawned static-server process
 * with its own port — see docs/ai-office plan: zero process/port lifecycle
 * to manage, and this codebase already hit a real orphaned-process bug
 * from a long-lived local server holding a resource open. Rendered by the
 * caller inside a sandboxed `<iframe sandbox="allow-scripts">` (no
 * `allow-same-origin`) so generated content runs as an opaque origin with
 * no access to this app's cookies or DOM, even though it's served
 * same-origin.
 *
 * Auth is deliberately EITHER of two things, not just the session cookie:
 * `verifySession()` (for someone opening this URL directly, unsandboxed),
 * OR a valid, project-scoped `?token=` query parameter minted by the
 * already-authenticated project detail page (see
 * lib/ai-office/auth/preview-token.ts's docblock for the full "why" — in
 * short, a sandboxed opaque-origin iframe never sends cookies for any of
 * its own requests, confirmed empirically, so cookie-only auth cannot
 * work here no matter how the sandbox is configured).
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; path: string[] }> }) {
  const { projectId, path: pathSegments } = await params;

  const token = new URL(request.url).searchParams.get("token");
  const authorized = (await verifySession()) !== null || (token !== null && (await verifyPreviewToken(token, projectId)));
  if (!authorized) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const relativePath = pathSegments.join("/") || "index.html";

  if (!workspaceExists(projectId)) {
    return NextResponse.json({ error: "No workspace exists for this project." }, { status: 404 });
  }

  let content: string;
  try {
    content = await readFile(projectId, relativePath);
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  // HTML entry points reference their own sibling resources
  // (styles.css, script.js) via plain relative hrefs — the browser
  // resolves those into brand-new requests that, inside the sandboxed
  // iframe, would carry neither the session cookie nor this token
  // unless it's embedded in the URL up front. Rewriting only local,
  // relative references (never absolute paths or external URLs) keeps
  // this narrowly scoped to "carry our own auth forward," not a general
  // HTML transform.
  if (token && relativePath.endsWith(".html")) {
    content = rewriteLocalResourceLinks(content, token);
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": getContentType(relativePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

