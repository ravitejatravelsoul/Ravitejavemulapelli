import "server-only";
import { listFiles, readFile, writeFile, createWorkspace, workspaceExists } from "../workspace/workspace-service.ts";
import { GitHubClient } from "./github-client.ts";
import type { RemoteRuntimeConfig } from "./remote-state-store.ts";

/**
 * Bridges the durable `workspaces/<projectId>/` tree in the private
 * runtime repo to the LOCAL filesystem `workspace-service.ts` already
 * knows how to read/write (`resolveSafePath`, size caps, atomic writes —
 * all reused, unmodified) — the caller is expected to have already set
 * `AI_OFFICE_WORKSPACES_ROOT` to a job-local temp directory (see
 * remote-worker.ts) before calling either function here.
 *
 * V1 scope: UTF-8 text files only, matching `workspace-service.ts`'s own
 * `readFile`/`writeFile` (fs.readFile(..., "utf8")) — every deliverable
 * this system currently produces (HTML/CSS/JS/README) is text. Binary
 * asset support (images, etc.) is a real, disclosed future extension,
 * not silently unsupported.
 *
 * One GitHub Contents API call per file — fine at this system's real
 * scale (a handful of files per project); a Git Trees API bulk
 * read/write would be the next step if that ever stops being true.
 */

function client(config: RemoteRuntimeConfig): GitHubClient {
  return new GitHubClient(config);
}

interface RemoteTreeEntry {
  path: string;
  type: "file" | "dir";
}

async function listRemoteTree(config: RemoteRuntimeConfig, remoteDir: string): Promise<RemoteTreeEntry[]> {
  const out: RemoteTreeEntry[] = [];
  async function walk(dir: string): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${dir}?ref=${encodeURIComponent(config.branch)}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store",
    });
    if (res.status === 404) return; // directory doesn't exist yet — a brand-new project's workspace
    if (!res.ok) throw new Error(`Failed to list ${dir}: ${res.status}`);
    const entries = (await res.json()) as Array<{ path: string; type: "file" | "dir" }>;
    for (const entry of entries) {
      if (entry.type === "dir") {
        await walk(entry.path);
      } else {
        out.push({ path: entry.path, type: "file" });
      }
    }
  }
  await walk(remoteDir);
  return out;
}

/** Downloads every file under `workspaces/<projectId>/` into the local (job-scoped) workspace directory. Safe to call for a project with no remote workspace yet — becomes a no-op. */
export async function downloadWorkspace(config: RemoteRuntimeConfig, projectId: string): Promise<void> {
  const remoteRoot = `workspaces/${projectId}`;
  const entries = await listRemoteTree(config, remoteRoot);
  if (entries.length === 0) return;

  if (!workspaceExists(projectId)) await createWorkspace(projectId);

  const gh = client(config);
  for (const entry of entries) {
    const relativePath = entry.path.slice(remoteRoot.length + 1);
    const file = await gh.getFile(entry.path);
    if (!file) continue; // raced with a delete — skip, not fatal
    await writeFile(projectId, relativePath, file.content);
  }
}

/** Uploads every local (job-scoped) workspace file for `projectId` back to `workspaces/<projectId>/`, creating or updating each as needed. */
export async function uploadWorkspace(config: RemoteRuntimeConfig, projectId: string): Promise<{ filesUploaded: number }> {
  if (!workspaceExists(projectId)) return { filesUploaded: 0 };

  const localFiles = await listFiles(projectId);
  const gh = client(config);
  let filesUploaded = 0;

  for (const relativePath of localFiles) {
    const content = await readFile(projectId, relativePath);
    const remotePath = `workspaces/${projectId}/${relativePath}`;
    const existing = await gh.getFile(remotePath);
    if (existing && existing.content === content) continue; // unchanged — skip the write, saves an API call and a no-op commit
    await gh.putFile(remotePath, content, {
      message: `chore(workspace): ${existing ? "update" : "add"} ${projectId}/${relativePath}`,
      expectedSha: existing?.sha,
    });
    filesUploaded += 1;
  }

  return { filesUploaded };
}
