"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { createProjectWithIdea } from "@/lib/ai-office/domain/projects";
import { planProject } from "@/lib/ai-office/orchestrator/orchestrator";
import {
  hydrateEphemeralDb,
  flushProjectBundle,
  flushOfficeState,
  readOfficeState,
  writeOfficeState,
  writeProjectBundle,
  remoteClientFromEnv,
  REMOTE_SYNTHETIC_OWNER_ID,
} from "@/lib/ai-office/remote/remote-state-store";
import { readProjectsIndex } from "@/lib/ai-office/remote/remote-dashboard-store";
import { GitHubClient } from "@/lib/ai-office/remote/github-client";

/**
 * Remote Mode's "Start New Project" — every action here independently
 * calls `verifySession()` (never trusts the layout alone, matching every
 * other action in this codebase). Reuses the exact same
 * `createProjectWithIdea()` + `planProject()` the local flow's
 * `createProjectAction` (app/office/actions/projects.ts) already calls —
 * no duplicated creation/planning logic, only where the resulting state
 * is persisted (GitHub, not `getAppDatabase()`) and who "starts" the
 * work (a dispatched GitHub Actions run, not this request staying open)
 * differ.
 *
 * Deliberately SIMULATED-only, LOCAL_ONLY policy, no budget cap
 * configuration yet — matches the plan's explicit "first proof uses a
 * free/no-Claude deterministic test project; architecture validation
 * needs no paid call." A real Claude LIVE remote project is a real,
 * disclosed follow-up, not silently unsupported forever.
 */

const newRemoteProjectSchema = z.object({
  title: z.string().trim().min(1, "Enter a project name.").max(120, "Keep the project name under 120 characters."),
  ideaText: z.string().trim().min(10, "Describe the idea in at least a sentence.").max(4000, "Keep the idea under 4000 characters."),
});

export interface CreateRemoteProjectState {
  error?: string;
  projectId?: string;
}

export async function createRemoteProjectAction(_prevState: CreateRemoteProjectState | undefined, formData: FormData): Promise<CreateRemoteProjectState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  const parsed = newRemoteProjectSchema.safeParse({
    title: formData.get("title"),
    ideaText: formData.get("ideaText"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a project name and an idea." };
  }

  let remoteConfig;
  try {
    remoteConfig = remoteClientFromEnv();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Remote Mode is not configured." };
  }

  const { state: office } = await readOfficeState(remoteConfig);
  const db = hydrateEphemeralDb(office, null);

  const { project } = createProjectWithIdea(db, {
    title: parsed.data.title,
    rawIdeaText: parsed.data.ideaText,
    ownerId: REMOTE_SYNTHETIC_OWNER_ID,
    provider: "simulated",
    aiPolicyMode: "LOCAL_ONLY",
    monthlyBudgetCapUsd: null,
  });

  try {
    planProject(db, project.id);
  } catch {
    return { error: "The project was created, but automatic planning failed." };
  }

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

  // Dispatch the first worker run — the project is now QUEUED to run in
  // the background; this request returns immediately after, per the
  // plan's explicit "return project ID immediately... UI shows QUEUED /
  // RUNNING... the browser must NOT need to remain open."
  await gh.dispatchWorkflow("ai-office-remote-worker.yml", {
    projectId: project.id,
    taskId: "",
    runId: crypto.randomUUID(),
    action: "start",
  });

  revalidatePath("/office");
  return { projectId: project.id };
}
