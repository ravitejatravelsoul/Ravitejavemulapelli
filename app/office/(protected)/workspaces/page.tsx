import type { Metadata } from "next";
import Link from "next/link";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { listProjects } from "@/lib/ai-office/domain/projects";
import { getWorkspace, listWorkspaceFileRecords } from "@/lib/ai-office/domain/workspace";
import { readFile } from "@/lib/ai-office/workspace/workspace-service";
import { highlightFileContent } from "@/lib/ai-office/workspace/code-highlight";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { FileBrowser, type WorkspaceFileEntry } from "@/components/ai-office/workspace/file-browser";

export const metadata: Metadata = { title: "Workspaces" };

/**
 * A cross-project workspace picker (Section 1/16-18) — every project with
 * a real workspace, pick one, browse its real files with the same safe
 * file-reading infrastructure the project detail page already uses. No
 * new file-access path: `readFile`/`highlightFileContent` are the exact
 * same calls the project detail page's Workspace tab makes.
 */
export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project: selectedProjectId } = await searchParams;
  const db = getAppDatabase();

  const projectsWithWorkspaces = listProjects(db)
    .map((project) => ({ project, workspace: getWorkspace(db, project.id) }))
    .filter((p): p is { project: (typeof p)["project"]; workspace: NonNullable<(typeof p)["workspace"]> } => p.workspace !== undefined)
    .sort((a, b) => b.project.updatedAt - a.project.updatedAt);

  const selected = selectedProjectId ? projectsWithWorkspaces.find((p) => p.project.id === selectedProjectId) : projectsWithWorkspaces[0];

  const fileEntries: WorkspaceFileEntry[] = selected
    ? await Promise.all(
        listWorkspaceFileRecords(db, selected.project.id).map(async (file) => {
          const content = await readFile(selected.project.id, file.path);
          return { path: file.path, sizeBytes: file.sizeBytes, lastModifiedByRoleId: file.lastModifiedByRoleId, html: await highlightFileContent(file.path, content) };
        }),
      )
    : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Workspaces</h1>

      {projectsWithWorkspaces.length === 0 ? (
        <GlassCard className="text-sm text-muted-foreground">No project has produced a real workspace yet.</GlassCard>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {projectsWithWorkspaces.map(({ project, workspace }) => (
              <Link
                key={project.id}
                href={`/office/workspaces?project=${project.id}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selected?.project.id === project.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {project.title}
                <span className="ml-1.5 font-mono text-[0.6rem] uppercase opacity-70">{workspace.deliveryState}</span>
              </Link>
            ))}
          </div>

          {selected && (
            <GlassCard>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight">{selected.project.title}</h2>
                <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                  {selected.workspace.deliveryState}
                </Badge>
                <span className="text-xs text-muted-foreground">{fileEntries.length} file(s)</span>
              </div>
              <div className="mt-4">
                <FileBrowser files={fileEntries} />
              </div>
            </GlassCard>
          )}
        </>
      )}
    </div>
  );
}
