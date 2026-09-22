import { verifySession } from "@/lib/ai-office/auth/dal";
import { getOfficeDb } from "@/lib/ai-office/office-db";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";
import { isAiOfficeOperationalModeEnabled } from "@/lib/ai-office/config/operational-mode";
import { getAIHeadquartersWorldState } from "@/lib/ai-office/headquarters/world-state";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!(await verifySession()))
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers },
    );
  const remote = isRemoteExecutionMode();
  if (!remote && !isAiOfficeOperationalModeEnabled())
    return Response.json(
      { error: "Office operations unavailable" },
      { status: 403, headers },
    );
  const project = new URL(request.url).searchParams.get("project") ?? undefined;
  if (project && !/^[a-zA-Z0-9_-]{1,100}$/.test(project))
    return Response.json(
      { error: "Invalid project" },
      { status: 400, headers },
    );
  const db = await getOfficeDb();
  try {
    const state = getAIHeadquartersWorldState(
      db,
      project,
      remote ? "remote" : "local",
    );
    const etag = '"' + state.revision + '"';
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, {
        status: 304,
        headers: { ...headers, ETag: etag },
      });
    return Response.json(state, { headers: { ...headers, ETag: etag } });
  } finally {
    if (remote) db.close();
  }
}
