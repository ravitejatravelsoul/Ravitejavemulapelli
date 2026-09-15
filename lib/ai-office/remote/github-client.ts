import "server-only";

/**
 * Thin wrapper around GitHub's REST API — deliberately plain `fetch`
 * (Node's built-in, already used elsewhere in this codebase — see
 * lib/ai-office/e2e/*.e2e.ts's `waitForServerReady`), not a new
 * `octokit`-family dependency. The surface needed here (get/put a file's
 * content, dispatch a workflow, list recent runs) is small enough that a
 * real SDK would add weight without adding safety.
 *
 * Every write is optimistic-concurrency-safe by construction: `putFile`
 * requires the caller to pass the `sha` it last read (or `undefined` only
 * for a file that has never existed), and GitHub's Contents API itself
 * rejects the write with 409/422 if that `sha` is stale — surfaced here
 * as `GitHubContentConflictError`, never silently overwritten.
 */

const GITHUB_API_BASE = "https://api.github.com";

export class GitHubContentConflictError extends Error {
  constructor(path: string) {
    super(`GitHub content write conflict at "${path}" — the file changed since it was last read.`);
    this.name = "GitHubContentConflictError";
  }
}

export class GitHubClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubClientError";
    this.status = status;
  }
}

export interface GitHubFile {
  content: string;
  sha: string;
}

export interface GitHubClientConfig {
  /** Never logged, never included in any thrown error message. */
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export class GitHubClient {
  private readonly config: GitHubClientConfig;

  constructor(config: GitHubClientConfig) {
    this.config = config;
  }

  private repoUrl(path: string): string {
    return `${GITHUB_API_BASE}/repos/${this.config.owner}/${this.config.repo}${path}`;
  }

  /**
   * Returns `null` (not an error) when the file does not exist yet.
   * `cache: "no-store"` is required, not optional — caught by real
   * testing, not inferred: Next.js caches `fetch()` calls made from
   * Server Components by default, so without this, an owner could see
   * stale project/approval state on a legitimate reload after a
   * background worker (or their own just-submitted decision) changed it
   * — actively dangerous for state a background system is constantly
   * mutating out from under the page.
   */
  async getFile(path: string): Promise<GitHubFile | null> {
    const res = await fetch(this.repoUrl(`/contents/${path}?ref=${encodeURIComponent(this.config.branch)}`), {
      headers: authHeaders(this.config.token),
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new GitHubClientError(`GET ${path} failed: ${res.status} ${await safeBody(res)}`, res.status);
    }
    const data = (await res.json()) as { content: string; encoding: string; sha: string };
    if (data.encoding !== "base64") {
      throw new GitHubClientError(`GET ${path} returned unexpected encoding "${data.encoding}"`, res.status);
    }
    return { content: Buffer.from(data.content, "base64").toString("utf-8"), sha: data.sha };
  }

  /**
   * `expectedSha`: pass the `sha` from a prior `getFile`, or `undefined`
   * only when creating a file that has never existed. Throws
   * `GitHubContentConflictError` (never silently overwrites) if the file
   * has changed since.
   */
  async putFile(path: string, content: string, opts: { message: string; expectedSha?: string }): Promise<{ sha: string }> {
    const res = await fetch(this.repoUrl(`/contents/${path}`), {
      method: "PUT",
      headers: { ...authHeaders(this.config.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: opts.message,
        content: Buffer.from(content, "utf-8").toString("base64"),
        branch: this.config.branch,
        ...(opts.expectedSha ? { sha: opts.expectedSha } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) {
      throw new GitHubContentConflictError(path);
    }
    if (!res.ok) {
      throw new GitHubClientError(`PUT ${path} failed: ${res.status} ${await safeBody(res)}`, res.status);
    }
    const data = (await res.json()) as { content: { sha: string } };
    return { sha: data.content.sha };
  }

  /** Deletes a file. Requires its current `sha` (same optimistic-concurrency contract as `putFile`). */
  async deleteFile(path: string, opts: { message: string; expectedSha: string }): Promise<void> {
    const res = await fetch(this.repoUrl(`/contents/${path}`), {
      method: "DELETE",
      headers: { ...authHeaders(this.config.token), "Content-Type": "application/json" },
      body: JSON.stringify({ message: opts.message, sha: opts.expectedSha, branch: this.config.branch }),
    });
    if (res.status === 409 || res.status === 422) {
      throw new GitHubContentConflictError(path);
    }
    if (!res.ok) {
      throw new GitHubClientError(`DELETE ${path} failed: ${res.status} ${await safeBody(res)}`, res.status);
    }
  }

  /** Triggers `workflow_dispatch` for a workflow file already present on `this.config.branch` (a hard GitHub requirement — see docs). */
  async dispatchWorkflow(workflowFileName: string, inputs: Record<string, string>): Promise<void> {
    const res = await fetch(this.repoUrl(`/actions/workflows/${workflowFileName}/dispatches`), {
      method: "POST",
      headers: { ...authHeaders(this.config.token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: this.config.branch, inputs }),
    });
    if (!res.ok) {
      throw new GitHubClientError(`workflow_dispatch for ${workflowFileName} failed: ${res.status} ${await safeBody(res)}`, res.status);
    }
  }

  async listWorkflowRuns(workflowFileName: string, opts: { perPage?: number } = {}): Promise<
    Array<{ id: number; status: string; conclusion: string | null; created_at: string; html_url: string }>
  > {
    const res = await fetch(this.repoUrl(`/actions/workflows/${workflowFileName}/runs?per_page=${opts.perPage ?? 10}&branch=${encodeURIComponent(this.config.branch)}`), {
      headers: authHeaders(this.config.token),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new GitHubClientError(`list workflow runs failed: ${res.status} ${await safeBody(res)}`, res.status);
    }
    const data = (await res.json()) as { workflow_runs: Array<{ id: number; status: string; conclusion: string | null; created_at: string; html_url: string }> };
    return data.workflow_runs;
  }
}

async function safeBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
