import "server-only";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runOneCycle } from "../lib/ai-office/runner/runner.ts";
import { findEligibleTasks } from "../lib/ai-office/runner/eligibility.ts";
import {
  hydrateEphemeralDb,
  flushProjectBundle,
  flushOfficeState,
  readOfficeState,
  writeOfficeState,
  readProjectBundle,
  writeProjectBundle,
  remoteClientFromEnv,
  GitHubContentConflictError,
} from "../lib/ai-office/remote/remote-state-store.ts";
import { downloadWorkspace, uploadWorkspace } from "../lib/ai-office/remote/remote-workspace-sync.ts";
import { GitHubClient } from "../lib/ai-office/remote/github-client.ts";

/**
 * Teja's AI Office — Remote Mode's GitHub Actions worker entry point.
 * Run via:
 *
 *   node --conditions=react-server scripts/ai-office-remote-worker.ts
 *
 * from a checkout of THIS repo (the Office engine code), with cwd set
 * there (matches every other script in this codebase's assumption — see
 * lib/ai-office/db/paths.ts). The workflow that invokes this
 * (teja-ai-office-runtime's .github/workflows/ai-office-remote-worker.yml)
 * checks this repo out into a subdirectory for exactly that reason.
 *
 * One bounded unit of work, exactly like the local Durable Runner's
 * `runOneCycle()` — which this directly calls, unmodified — except:
 *   - state is hydrated from / flushed to the private runtime repo
 *     (GitHub Contents API, optimistic concurrency) instead of a local
 *     `.data/office.db` file
 *   - the workspace filesystem is downloaded from / uploaded to the
 *     runtime repo instead of already being on disk
 *   - "is there more eligible work" after this cycle decides whether to
 *     dispatch a follow-up `workflow_dispatch` run of this same
 *     workflow — this is what makes background execution continue after
 *     the browser (or this process) closes: the CHAIN is driven by the
 *     worker itself, never by anything polling from outside.
 *
 * Required env:
 *   AI_OFFICE_REMOTE_PROJECT_ID   — which project's bundle to operate on
 *   AI_OFFICE_REMOTE_GITHUB_TOKEN — token with contents+actions write on the runtime repo
 *   AI_OFFICE_REMOTE_REPO_OWNER, AI_OFFICE_REMOTE_REPO_NAME
 * Optional env:
 *   AI_OFFICE_REMOTE_REPO_BRANCH  — default "main"
 *   AI_OFFICE_REMOTE_RUN_ID       — identifies this worker for task leasing (leaseOwnerId); defaults to a random id (lower-env/manual runs)
 *   AI_OFFICE_REMOTE_WORKFLOW_FILE — self-dispatch target; default "ai-office-remote-worker.yml"
 *   AI_OFFICE_REMOTE_NO_DISPATCH  — "1" to run exactly one cycle and never self-dispatch (used by lower-env tests that want to observe one step at a time)
 */

function log(message: string): void {
  console.log(`[remote-worker] ${message}`);
}

async function main(): Promise<void> {
  const projectId = requireEnv("AI_OFFICE_REMOTE_PROJECT_ID");
  const remoteConfig = remoteClientFromEnv();
  const runnerId = process.env.AI_OFFICE_REMOTE_RUN_ID || `manual-${randomUUID()}`;
  const workflowFile = process.env.AI_OFFICE_REMOTE_WORKFLOW_FILE || "ai-office-remote-worker.yml";
  const noDispatch = process.env.AI_OFFICE_REMOTE_NO_DISPATCH === "1";

  log(`starting cycle — project=${projectId} runnerId=${runnerId}`);

  const [{ state: office, sha: officeSha }, { bundle, sha: bundleSha }] = await Promise.all([
    readOfficeState(remoteConfig),
    readProjectBundle(remoteConfig, projectId),
  ]);

  if (!bundle) {
    log(`no bundle exists yet for project ${projectId} — nothing to execute. Exiting.`);
    return;
  }

  const localWorkspaceRoot = mkdtempSync(join(tmpdir(), "ai-office-remote-workspace-"));
  process.env.AI_OFFICE_WORKSPACES_ROOT = localWorkspaceRoot;

  try {
    log("downloading workspace files from runtime repo...");
    await downloadWorkspace(remoteConfig, projectId);

    log("hydrating ephemeral database...");
    const db = hydrateEphemeralDb(office, bundle);

    log("running one bounded cycle...");
    const outcome = await runOneCycle(db, runnerId);
    log(`cycle outcome: ${outcome.kind}${outcome.detail ? " " + JSON.stringify(outcome.detail) : ""}`);

    log("uploading changed workspace files to runtime repo...");
    const { filesUploaded } = await uploadWorkspace(remoteConfig, projectId);
    log(`workspace: ${filesUploaded} file(s) uploaded`);

    const newBundle = flushProjectBundle(db, projectId);
    const newOffice = flushOfficeState(db);

    try {
      await writeProjectBundle(remoteConfig, newBundle, bundleSha);
    } catch (error) {
      if (error instanceof GitHubContentConflictError) {
        // Real conflict backstop — the primary defense is the GitHub
        // Actions `concurrency` group (ai-office-<projectId>), which
        // should make this unreachable in normal operation. If it's
        // ever hit anyway, fail loudly rather than attempt an automatic
        // merge of two concurrent writers' SQL-level changes — that's a
        // meaningfully harder problem than this system needs to solve
        // for a single-owner tool with proper concurrency control
        // already in place. The next scheduled/dispatched cycle will
        // reload the (other writer's) current state and continue
        // correctly from there.
        log(`CONFLICT writing project bundle for ${projectId} — another writer committed first. Not overwriting. Stopping this job.`);
        return;
      }
      throw error;
    }

    if (JSON.stringify(newOffice) !== JSON.stringify(office)) {
      await writeOfficeState(remoteConfig, newOffice, officeSha);
    }

    if (noDispatch) {
      log("AI_OFFICE_REMOTE_NO_DISPATCH=1 — not checking for follow-up work.");
      return;
    }

    if (outcome.kind === "office-closed" || outcome.kind === "idle" || outcome.kind === "no-eligible-work" || outcome.kind === "live-mode-refused" || outcome.kind === "error") {
      log(`no follow-up dispatch — cycle outcome "${outcome.kind}" needs no further work right now.`);
      return;
    }

    // "executed" or "recovered": more work may now be eligible.
    const stillEligible = findEligibleTasks(db);
    if (stillEligible.length === 0) {
      log("no further eligible tasks — chain ends here.");
      return;
    }

    log(`${stillEligible.length} task(s) still eligible — dispatching a follow-up run.`);
    const gh = new GitHubClient(remoteConfig);
    await gh.dispatchWorkflow(workflowFile, { projectId, taskId: "", runId: randomUUID(), action: "continue" });
    log("follow-up run dispatched.");
  } finally {
    rmSync(localWorkspaceRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable "${name}" is not set.`);
  return value;
}

main().catch((error) => {
  console.error("[remote-worker] fatal error:", error);
  process.exitCode = 1;
});
