"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { createProjectWithIdea, routingModeHonored } from "@/lib/ai-office/domain/projects";
import { planProject } from "@/lib/ai-office/orchestrator/orchestrator";
import {
  hydrateEphemeralDb,
  flushProjectBundle,
  readOfficeState,
  writeProjectBundle,
  remoteClientFromEnv,
  REMOTE_SYNTHETIC_OWNER_ID,
} from "@/lib/ai-office/remote/remote-state-store";
import { GitHubClient, GitHubContentConflictError } from "@/lib/ai-office/remote/github-client";
import { readModelCatalog } from "@/lib/ai-office/remote/model-catalog";
import { selectFreeModel } from "@/lib/ai-office/agents/free-model-router";
import { requiredCapabilitiesForTask } from "@/lib/ai-office/agents/free-model-capabilities";

/** Bounded — see remote-approvals.ts's identical constant/reasoning: `state/projects-index.json` and `state/office.json` are shared across every remote project, so two concurrent creations can genuinely race to update them. */
const MAX_WRITE_ATTEMPTS = 3;

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
 * Supports explicit FREE_MULTI_MODEL only after the existing task capability gates pass.
 * STANDARD remains deterministic simulated execution; Claude is never selected.
 */

const newRemoteProjectSchema = z.object({
  title: z.string().trim().min(1, "Enter a project name.").max(120, "Keep the project name under 120 characters."),
  ideaText: z.string().trim().min(10, "Describe the idea in at least a sentence.").max(4000, "Keep the idea under 4000 characters."),
  routingMode:z.enum(["STANDARD","FREE_MULTI_MODEL"]).default("STANDARD"),
});

export interface CreateRemoteProjectState {
  error?: string;
  projectId?: string;
  /** The routing mode actually persisted on the created project row — read back from the database, never merely echoed from the request. The caller must compare this against what it asked for; never assume the request was honored. */
  routingMode?: "STANDARD" | "FREE_MULTI_MODEL";
  /**
   * Echoed back so the form can refill itself after a failed attempt —
   * matching OfficeLoginState's established "never lose what the owner
   * typed" pattern (app/office/actions/auth.ts). Real incident: before
   * this field existed, ANY error here (a missing env var, an unsynced
   * catalog, a transient lease) silently discarded the title/idea the
   * owner had just written and reset the mode dropdown back to
   * "Simulated" — forcing a full retype even though the mistake was
   * never theirs. Never populated on success (the idea becomes the
   * created project's own record at that point).
   */
  title?: string;
  ideaText?: string;
}

export async function createRemoteProjectAction(_prevState: CreateRemoteProjectState | undefined, formData: FormData): Promise<CreateRemoteProjectState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  // Raw, unvalidated echo values — captured before parsing so the form
  // can refill itself even when validation itself is what failed (e.g.
  // idea too short). Only ever echoed back, never trusted as input.
  const rawTitle = typeof formData.get("title") === "string" ? (formData.get("title") as string) : undefined;
  const rawIdeaText = typeof formData.get("ideaText") === "string" ? (formData.get("ideaText") as string) : undefined;
  const rawRoutingMode = formData.get("routingMode") === "FREE_MULTI_MODEL" ? "FREE_MULTI_MODEL" : "STANDARD";

  const parsed = newRemoteProjectSchema.safeParse({
    title: rawTitle,
    ideaText: rawIdeaText,
    routingMode: rawRoutingMode,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a project name and an idea.", title: rawTitle, ideaText: rawIdeaText, routingMode: rawRoutingMode };
  }
  const echo = { title: parsed.data.title, ideaText: parsed.data.ideaText, routingMode: parsed.data.routingMode };

  let remoteConfig;
  try {
    remoteConfig = remoteClientFromEnv();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Remote Mode is not configured.", ...echo };
  }

  const { state: office } = await readOfficeState(remoteConfig);
  const {catalog}=await readModelCatalog(remoteConfig);
  if (parsed.data.routingMode === "FREE_MULTI_MODEL") {
    if (!catalog) {
      return {
        error:
          "Real free-model execution isn't set up yet: no model catalog has been synchronized to this runtime (run scripts/ai-office-remote-sync-models.ts, or check the Models page for status). Choose \"Simulated\" below to continue without real execution, or try again once an admin has synchronized it.",
        ...echo,
      };
    }
    if (catalog.lease) {
      return {
        error: "A remote worker is currently reading or updating the model catalog. This is expected to clear within a minute or two — please try again shortly.",
        ...echo,
      };
    }
  }
  const db = hydrateEphemeralDb(office, null,catalog);

  const { project } = createProjectWithIdea(db, {
    title: parsed.data.title,
    rawIdeaText: parsed.data.ideaText,
    ownerId: REMOTE_SYNTHETIC_OWNER_ID,
    provider: "simulated",
    routingMode:parsed.data.routingMode,
    aiPolicyMode: "LOCAL_ONLY",
    monthlyBudgetCapUsd: null,
  });

  try {
    planProject(db, project.id);
  } catch {
    return { error: "The project was created, but automatic planning failed.", ...echo };
  }

  // Fail-closed invariant: a project that was explicitly requested as
  // FREE_MULTI_MODEL must never be persisted, dispatched or reported as
  // success under any other routing mode — this is checked by reading
  // the value actually written to `db`, not by trusting the request,
  // and sits before the bundle is ever written to GitHub or a workflow
  // is ever dispatched. Never fires for a project that genuinely asked
  // for STANDARD/simulated execution (that remains fully supported).
  if (!routingModeHonored(parsed.data.routingMode, project.routingMode)) {
    return { error: "Internal routing error: FREE_MULTI_MODEL was requested but could not be persisted. No remote project was saved or dispatched.", ...echo };
  }

  if(parsed.data.routingMode==="FREE_MULTI_MODEL") {
    for(const task of db.prepare("SELECT roleId,title FROM tasks WHERE projectId=?").all(project.id) as Array<{roleId:string;title:string}>){
      const required=requiredCapabilitiesForTask(task.roleId,task.title);
      if(!selectFreeModel(db,{capability:required[0]!,requiredCapabilities:required})) {
        return {
          error: `No currently qualified, enabled free model supports the "${task.roleId}" role's required capabilities (${required.join(", ")}). This usually means the model catalog is stale, a provider's free-tier confirmation env vars aren't set, or every qualified model is temporarily unhealthy — check the Models page for per-provider status. No remote project was saved or dispatched; choose "Simulated" below to proceed without real execution, or try again once a qualified model is available.`,
          ...echo,
        };
      }
    }
  }

  const bundle = flushProjectBundle(db, project.id);


  await writeProjectBundle(remoteConfig, bundle, null);

  const gh = new GitHubClient(remoteConfig);

  // Bounded retry — state/projects-index.json is shared across every
  // remote project, so two owners (or two tabs) creating a project at
  // nearly the same time can genuinely race to update it; re-read the
  // current index and re-append on conflict rather than silently
  // overwriting (or losing) a concurrently-created entry.
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const indexFile = await gh.getFile("state/projects-index.json");
    const existingIndex = indexFile?JSON.parse(indexFile.content).projects:[];
    existingIndex.push({ id: project.id, title: project.title, status: project.status, updatedAt: new Date().toISOString() });
    try {
      await gh.putFile("state/projects-index.json", JSON.stringify({ projects: existingIndex, updatedAt: new Date().toISOString() }, null, 2) + "\n", {
        message: `chore(state): add ${project.id} to projects index`,
        expectedSha: indexFile?.sha,
      });
      break;
    } catch (error) {
      if (error instanceof GitHubContentConflictError && attempt < MAX_WRITE_ATTEMPTS) continue;
      // The project itself is already created and durable — only its
      // listing in the index failed. Not fatal: it will still show up
      // once hydrateAllRemoteProjects (or a retry of this same action
      // path) re-derives the index, but surface this honestly rather
      // than silently pretending the index update succeeded.
      return { error: "Project created, but the projects list could not be updated (it will still appear once the list is refreshed). Please refresh." };
    }
  }

  // Creation does not mutate office state; never overwrite a concurrent owner change.

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

  revalidatePath("/office", "layout");
  return { projectId: project.id, routingMode: project.routingMode };
}
