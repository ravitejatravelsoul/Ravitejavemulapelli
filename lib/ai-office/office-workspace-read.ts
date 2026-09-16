import "server-only";
import { isRemoteExecutionMode } from "./remote/execution-mode.ts";

/**
 * Mode-aware file content read — the workspace-file counterpart to
 * office-db.ts. Local mode: existing `workspace-service.ts` (local
 * filesystem, unmodified). Remote mode: reads the file directly from
 * `workspaces/<projectId>/<path>` in the private runtime repo via the
 * GitHub Contents API — dashboard reads never depend on a job-local temp
 * directory (that only exists for the duration of a worker run).
 * Returns `null` (never throws) when the file can't be read, so callers
 * show an honest empty state instead of a crash — this codebase's
 * existing "no fake completion" rule applied to a read path.
 */
export async function readOfficeWorkspaceFile(projectId: string, relativePath: string): Promise<string | null> {
  if (isRemoteExecutionMode()) {
    try {
      const { remoteClientFromEnv } = await import("./remote/remote-state-store.ts");
      const { GitHubClient } = await import("./remote/github-client.ts");
      const config = remoteClientFromEnv();
      const gh = new GitHubClient(config);
      const file = await gh.getFile(`workspaces/${projectId}/${relativePath}`);
      return file?.content ?? null;
    } catch {
      return null;
    }
  }

  try {
    const { readFile } = await import("./workspace/workspace-service.ts");
    return await readFile(projectId, relativePath);
  } catch {
    return null;
  }
}
