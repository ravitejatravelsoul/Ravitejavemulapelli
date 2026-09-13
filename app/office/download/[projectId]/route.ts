import { NextResponse } from "next/server";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getProject, getProjectIdea } from "@/lib/ai-office/domain/projects";
import { workspaceExists, listFiles, readFile } from "@/lib/ai-office/workspace/workspace-service";
import { generateReadme } from "@/lib/ai-office/workspace/readme-generator";
import { createZip } from "@/lib/ai-office/workspace/zip";

export const dynamic = "force-dynamic";

/**
 * Platform-hardening phase, Part 5A — owner-only "Download Project ZIP."
 * Deliberately never touches anything outside this one project's
 * isolated workspace directory (`.data/ai-office-workspaces/<projectId>/`,
 * via the same `resolveSafePath`-guarded `workspace-service` every other
 * workspace read/write already goes through) — there is structurally
 * nothing else in that directory tree to accidentally include: no
 * `.env`, no `.env.local`, no secrets, no AI Office database, no
 * `node_modules`, no internal Office files. Those all live entirely
 * outside the workspace root by construction, never inside it.
 *
 * README.md is generated fresh into the ZIP (via `generateReadme`) if
 * the workspace doesn't already have its own `README.md` file — never
 * overwriting a real one an agent may have written, and never costing a
 * real AI call (pure, free, deterministic derivation).
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { projectId } = await params;
  const db = getAppDatabase();
  const project = getProject(db, projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (!workspaceExists(projectId)) {
    return NextResponse.json({ error: "This project has no real workspace yet." }, { status: 404 });
  }

  const relativePaths = await listFiles(projectId);
  const files = await Promise.all(
    relativePaths.map(async (path) => ({ path, content: await readFile(projectId, path) })),
  );

  if (!relativePaths.some((p) => p.toLowerCase() === "readme.md")) {
    const idea = getProjectIdea(db, projectId);
    files.push({
      path: "README.md",
      content: generateReadme({ projectTitle: project.title, ideaText: idea?.rawText ?? "", files: relativePaths }),
    });
  }

  const zip = createZip(files);
  const safeFilename = project.title.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "project";

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeFilename}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
