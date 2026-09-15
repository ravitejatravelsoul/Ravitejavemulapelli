import "server-only";
import { findEligibleTasks } from "../lib/ai-office/runner/eligibility.ts";
import { hydrateEphemeralDb, readOfficeState, readProjectBundle, remoteClientFromEnv } from "../lib/ai-office/remote/remote-state-store.ts";
import { readProjectsIndex } from "../lib/ai-office/remote/remote-dashboard-store.ts";
import { GitHubClient } from "../lib/ai-office/remote/github-client.ts";

/**
 * Remote Mode's lightweight self-healing sweep (Phase R10) — run on a
 * low-frequency GitHub Actions schedule (see
 * .github/workflows/ai-office-remote-recovery.yml in the runtime repo),
 * never invoked just to "monitor": every check here is a handful of
 * cheap reads (no AI call, ever), and the sweep dispatches a worker run
 * ONLY for a project that genuinely has real eligible work waiting.
 *
 * Why this is needed at all: `runOneCycle()`'s own
 * `recoverStaleLeases()` (lib/ai-office/runner/runner.ts) already
 * reclaims a stale-leased task the moment *some* worker run for that
 * project executes — but if a project's self-dispatch chain silently
 * stops (a worker crashed before it could dispatch its own follow-up, a
 * `workflow_dispatch` call itself failed, etc.), nothing kicks off that
 * next run on its own. This sweep is that "who dispatches the next one"
 * safety net, and nothing more: `findEligibleTasks()` already returns a
 * task whose lease has simply expired (`leaseExpiresAt IS NULL OR
 * leaseExpiresAt < asOf`) exactly the same as a genuinely fresh PENDING
 * one, so one check covers both "orphaned RUNNING task" and "orphaned
 * runnable project" — the exact two cases the plan calls out.
 *
 * Bounded and cheap by construction: reads `projects-index.json` once,
 * then one project-bundle read per IN_PROGRESS project (no ephemeral-DB
 * writes, no flush, no npm install of anything beyond what's already in
 * node_modules — this script needs no Playwright, unlike the worker).
 */

function log(message: string): void {
  console.log(`[recovery-sweep] ${message}`);
}

async function main(): Promise<void> {
  const remoteConfig = remoteClientFromEnv();
  const { state: office } = await readOfficeState(remoteConfig);

  if (office.state !== "OPEN") {
    log("office is CLOSED — nothing to sweep.");
    return;
  }

  const index = await readProjectsIndex(remoteConfig);
  const inProgress = index.filter((p) => p.status === "IN_PROGRESS");
  if (inProgress.length === 0) {
    log("no IN_PROGRESS remote projects — nothing to sweep.");
    return;
  }

  const gh = new GitHubClient(remoteConfig);
  let dispatched = 0;

  for (const entry of inProgress) {
    const { bundle } = await readProjectBundle(remoteConfig, entry.id);
    if (!bundle) continue;

    const db = hydrateEphemeralDb(office, bundle);
    const eligible = findEligibleTasks(db);
    if (eligible.length === 0) continue;

    log(`project ${entry.id} ("${entry.title}") has ${eligible.length} eligible task(s) but no active run detected — dispatching recovery.`);
    await gh.dispatchWorkflow("ai-office-remote-worker.yml", { projectId: entry.id, taskId: "", runId: crypto.randomUUID(), action: "continue" });
    dispatched += 1;
  }

  log(`sweep complete — ${dispatched} recovery dispatch(es) out of ${inProgress.length} IN_PROGRESS project(s).`);
}

main().catch((error) => {
  console.error("[recovery-sweep] fatal error:", error);
  process.exitCode = 1;
});
