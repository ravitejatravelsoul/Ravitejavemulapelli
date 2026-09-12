import { NextResponse } from "next/server";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { readFile, workspaceExists, WorkspacePathError, getContentType } from "@/lib/ai-office/workspace/workspace-service";

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
 * `verifySession()` is called directly (not inherited from a layout) per
 * lib/ai-office/auth/dal.ts's documented boundary — this route lives
 * outside the `(protected)` route group, and Route Handlers never
 * automatically inherit a parent layout's auth check.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; path: string[] }> }) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { projectId, path: pathSegments } = await params;
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

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": getContentType(relativePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
