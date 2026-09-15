import "server-only";
import { createProjectWithIdea } from "../lib/ai-office/domain/projects.ts";
import { planProject } from "../lib/ai-office/orchestrator/orchestrator.ts";
import { createApproval } from "../lib/ai-office/domain/project-outputs.ts";
import { recordEvent } from "../lib/ai-office/domain/events.ts";
import {
  hydrateEphemeralDb,
  flushProjectBundle,
  flushOfficeState,
  readOfficeState,
  writeOfficeState,
  writeProjectBundle,
  remoteClientFromEnv,
  REMOTE_SYNTHETIC_OWNER_ID,
} from "../lib/ai-office/remote/remote-state-store.ts";
import { readProjectsIndex } from "../lib/ai-office/remote/remote-dashboard-store.ts";
import { GitHubClient } from "../lib/ai-office/remote/github-client.ts";

/**
 * Lower-env-only: creates a test project (like
 * ai-office-remote-seed-test-project.ts) AND immediately inserts one
 * real PENDING, project-scoped approval directly via the same
 * `createApproval()` domain function a real blocking scenario would —
 * this is the ONLY manufactured part; deciding it afterward goes through
 * the real `approveRemoteApprovalAction`/`approveApproval()` path,
 * unmodified. Exists purely to close the one gap the R6-R8 report
 * flagged: the approval-resume action had not yet been exercised
 * against a real pending approval end to end.
 */
async function main(): Promise<void> {
  const remoteConfig = remoteClientFromEnv();
  const { state: office } = await readOfficeState(remoteConfig);

  const db = hydrateEphemeralDb(office, null);

  const { project } = createProjectWithIdea(db, {
    title: "Approval Flow Test",
    rawIdeaText: "A tiny test project used only to exercise the Remote Mode approve/reject action end to end.",
    ownerId: REMOTE_SYNTHETIC_OWNER_ID,
    provider: "simulated",
    aiPolicyMode: "LOCAL_ONLY",
    monthlyBudgetCapUsd: null,
  });
  planProject(db, project.id);

  const approval = createApproval(db, {
    projectId: project.id,
    kind: "budget_increase",
    requestedBy: "test-harness",
    context: { scope: "project", oldCapUsd: 0, newCapUsd: 5, reason: "Lower-env test of the Remote Mode approval-resume action." },
  });
  recordEvent(db, {
    projectId: project.id,
    type: "approval.required",
    payload: { approvalId: approval.id, kind: approval.kind },
    actor: "test-harness",
  });

  const bundle = flushProjectBundle(db, project.id);
  const newOffice = flushOfficeState(db);
  await writeProjectBundle(remoteConfig, bundle, null);

  const gh = new GitHubClient(remoteConfig);
  const existingIndex = await readProjectsIndex(remoteConfig);
  const indexFile = await gh.getFile("state/projects-index.json");
  existingIndex.push({ id: project.id, title: project.title, status: project.status, updatedAt: new Date().toISOString() });
  await gh.putFile("state/projects-index.json", JSON.stringify({ projects: existingIndex, updatedAt: new Date().toISOString() }, null, 2) + "\n", {
    message: `chore(state): add ${project.id} to projects index`,
    expectedSha: indexFile?.sha,
  });

  const officeRes = await readOfficeState(remoteConfig);
  await writeOfficeState(remoteConfig, newOffice, officeRes.sha);

  console.log(`created project ${project.id} with pending approval ${approval.id}`);
  console.log(project.id);
}

main().catch((error) => {
  console.error("fatal error:", error);
  process.exitCode = 1;
});
