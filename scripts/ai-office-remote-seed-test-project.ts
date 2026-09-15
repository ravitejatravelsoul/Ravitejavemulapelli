import "server-only";
import { createProjectWithIdea } from "../lib/ai-office/domain/projects.ts";
import { planProject } from "../lib/ai-office/orchestrator/orchestrator.ts";
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
import { GitHubClient } from "../lib/ai-office/remote/github-client.ts";

/**
 * Lower-env-only seed script: creates a brand-new Remote Mode test
 * project (id prefixed `test-`, per teja-ai-office-runtime's README
 * namespace convention) directly in the private runtime repo, WITHOUT
 * going through the Vercel UI (Phase R7 — "Create Project from Vercel" —
 * comes later; this script exists purely to prove the background-worker
 * architecture end to end first, deterministically, with zero paid
 * calls). Reuses the exact same `createProjectWithIdea` +
 * `planProject()` the real local/remote "Start New Project" flow calls —
 * no duplicated project-creation logic.
 *
 * Usage:
 *   node --conditions=react-server scripts/ai-office-remote-seed-test-project.ts "Project Title" "idea text"
 *
 * Does NOT dispatch a workflow run itself — print the project id and let
 * the caller decide when to kick off the chain (keeps this script a pure
 * "create state" step, easy to reuse for a test harness that wants to
 * inspect the seeded bundle before triggering anything).
 */

function log(message: string): void {
  console.log(`[seed-test-project] ${message}`);
}

async function main(): Promise<void> {
  const title = process.argv[2];
  const ideaText = process.argv[3];
  if (!title || !ideaText) {
    console.error('Usage: node --conditions=react-server scripts/ai-office-remote-seed-test-project.ts "Title" "idea text"');
    process.exitCode = 1;
    return;
  }

  const remoteConfig = remoteClientFromEnv();
  const { state: office } = await readOfficeState(remoteConfig);

  const db = hydrateEphemeralDb(office, null);

  const { project } = createProjectWithIdea(db, {
    title,
    rawIdeaText: ideaText,
    ownerId: REMOTE_SYNTHETIC_OWNER_ID,
    provider: "simulated",
    aiPolicyMode: "LOCAL_ONLY",
    monthlyBudgetCapUsd: null,
  });

  planProject(db, project.id);

  const bundle = flushProjectBundle(db, project.id);
  const newOffice = flushOfficeState(db);

  await writeProjectBundle(remoteConfig, bundle, null);

  const gh = new GitHubClient(remoteConfig);
  const indexFile = await gh.getFile("state/projects-index.json");
  const index = indexFile ? (JSON.parse(indexFile.content) as { projects: Array<{ id: string; title: string; status: string; updatedAt: string }>; updatedAt: string }) : { projects: [], updatedAt: new Date(0).toISOString() };
  index.projects.push({ id: project.id, title: project.title, status: project.status, updatedAt: new Date().toISOString() });
  index.updatedAt = new Date().toISOString();
  await gh.putFile("state/projects-index.json", JSON.stringify(index, null, 2) + "\n", {
    message: `chore(state): add ${project.id} to projects index`,
    expectedSha: indexFile?.sha,
  });

  const officeRes = await readOfficeState(remoteConfig);
  await writeOfficeState(remoteConfig, newOffice, officeRes.sha);

  log(`created project ${project.id} ("${project.title}"), planned, pushed to runtime repo.`);
  console.log(project.id);
}

main().catch((error) => {
  console.error("[seed-test-project] fatal error:", error);
  process.exitCode = 1;
});
