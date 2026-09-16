"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOwner } from "@/lib/ai-office/domain/users";
import { createProjectWithIdea } from "@/lib/ai-office/domain/projects";
import { planProject } from "@/lib/ai-office/orchestrator/orchestrator";
import { pauseProject, resumeProject } from "@/lib/ai-office/control/project-transitions";
import { isAiOfficeOperationalModeEnabled, OPERATIONAL_MODE_DISABLED_MESSAGE } from "@/lib/ai-office/config/operational-mode";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";
import { withRemoteProjectMutation, REMOTE_SYNTHETIC_OWNER_ID as REMOTE_OWNER_FALLBACK } from "@/lib/ai-office/remote/remote-state-store";
import { createRemoteProjectAction } from "@/app/office/actions/remote-projects";

/**
 * "Start New Project" + Pause/Resume — every action here independently
 * calls `verifySession()` (never trusts the `(protected)` layout alone)
 * and treats every id arriving from the browser as untrusted: a project
 * id that doesn't exist, or belongs to a state the requested transition
 * doesn't allow, produces a clean `{ error }` result, never a thrown
 * stack trace or a silent no-op that looks like success.
 */

const newProjectSchema = z.object({
  title: z.string().trim().min(1, "Enter a project name.").max(120, "Keep the project name under 120 characters."),
  ideaText: z.string().trim().min(10, "Describe the idea in at least a sentence.").max(4000, "Keep the idea under 4000 characters."),
  provider: z.enum(["simulated", "ollama"]).default("simulated"),
  // Controlled Claude LIVE pilot (Part 10) — deliberately defaults to
  // LOCAL_ONLY, matching createProjectWithIdea's own default; the form
  // never pre-selects HYBRID or CLAUDE_ONLY, so an owner must explicitly
  // opt a project into paid AI.
  aiPolicyMode: z.enum(["LOCAL_ONLY", "HYBRID", "CLAUDE_ONLY"]).default("LOCAL_ONLY"),
});

/** Fixed at $3.00 per Part 7 — every HYBRID/CLAUDE_ONLY project gets the same conservative default LIVE cap; a LOCAL_ONLY project gets no cap at all (it can never spend). Not owner-configurable from this form yet — raising it is a deliberate future action, never a silent default. */
const DEFAULT_LIVE_PROJECT_BUDGET_CAP_USD = 3.0;

export interface CreateProjectState {
  error?: string;
}

/**
 * Idea in, planned project out — the only thing this does beyond
 * validating and persisting is call the existing, already-tested
 * `planProject()` (Phase 5's deterministic Orchestrator). Always
 * SIMULATED (`createProjectWithIdea`'s `aiMode` defaults to
 * `"SIMULATED"` when omitted here — never set explicitly to `"LIVE"`
 * from this form). Planning itself is a deterministic keyword
 * classifier, not a model — no AI is called during planning either
 * way. `provider` ("simulated" | "ollama") only decides which adapter
 * later *executes* the planned tasks; it never changes `aiMode`.
 */
export async function createProjectAction(_prevState: CreateProjectState | undefined, formData: FormData): Promise<CreateProjectState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  // Remote Mode has no local operational-mode flag, no Ollama/Claude
  // provider choice (createRemoteProjectAction is deliberately
  // SIMULATED-only, LOCAL_ONLY policy — see that file's docblock), and
  // persists to GitHub instead of getAppDatabase(); reusing it here keeps
  // this the SAME "Start New Project" form/route for both modes rather
  // than a second remote-only page.
  if (isRemoteExecutionMode()) {
    const result = await createRemoteProjectAction(undefined, formData);
    if (result.error) return { error: result.error };
    if (result.projectId) redirect(`/office/projects/${result.projectId}`);
    return { error: "Project creation did not return a project id." };
  }

  if (!isAiOfficeOperationalModeEnabled()) return { error: OPERATIONAL_MODE_DISABLED_MESSAGE };

  const parsed = newProjectSchema.safeParse({
    title: formData.get("title"),
    ideaText: formData.get("ideaText"),
    provider: formData.get("provider") || undefined,
    aiPolicyMode: formData.get("aiPolicyMode") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a project name and an idea." };
  }

  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };

  const { project } = createProjectWithIdea(db, {
    title: parsed.data.title,
    rawIdeaText: parsed.data.ideaText,
    ownerId: owner.id,
    provider: parsed.data.provider,
    aiPolicyMode: parsed.data.aiPolicyMode,
    monthlyBudgetCapUsd: parsed.data.aiPolicyMode === "LOCAL_ONLY" ? null : DEFAULT_LIVE_PROJECT_BUDGET_CAP_USD,
  });

  try {
    planProject(db, project.id);
  } catch {
    return { error: "The project was created, but automatic planning failed. Open the project to try again." };
  }

  revalidatePath("/office");
  redirect(`/office/projects/${project.id}`);
}

export interface ProjectTransitionActionState {
  error?: string;
}

async function withOwnerSession(): Promise<{ error: string } | { db: ReturnType<typeof getAppDatabase>; ownerId: string }> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  const db = getAppDatabase();
  const owner = getOwner(db);
  if (!owner) return { error: "Owner account not found." };
  return { db, ownerId: owner.id };
}

export async function pauseProjectAction(projectId: string): Promise<ProjectTransitionActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof projectId !== "string" || projectId.length === 0) return { error: "Invalid project." };

  if (isRemoteExecutionMode()) {
    const result = await withRemoteProjectMutation(projectId, (db) => {
      const r = pauseProject(db, projectId, REMOTE_OWNER_FALLBACK);
      return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.reason };
    });
    revalidatePath("/office");
    revalidatePath(`/office/projects/${projectId}`);
    return result.ok ? {} : { error: result.error };
  }

  const ctx = await withOwnerSession();
  if ("error" in ctx) return ctx;

  const result = pauseProject(ctx.db, projectId, ctx.ownerId);
  revalidatePath("/office");
  revalidatePath(`/office/projects/${projectId}`);
  return result.ok ? {} : { error: result.reason };
}

export async function resumeProjectAction(projectId: string): Promise<ProjectTransitionActionState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };
  if (typeof projectId !== "string" || projectId.length === 0) return { error: "Invalid project." };

  if (isRemoteExecutionMode()) {
    const result = await withRemoteProjectMutation(
      projectId,
      (db) => {
        const r = resumeProject(db, projectId, REMOTE_OWNER_FALLBACK);
        return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.reason };
      },
      { dispatchContinue: true },
    );
    revalidatePath("/office");
    revalidatePath(`/office/projects/${projectId}`);
    return result.ok ? {} : { error: result.error };
  }

  const ctx = await withOwnerSession();
  if ("error" in ctx) return ctx;
  if (!isAiOfficeOperationalModeEnabled()) return { error: OPERATIONAL_MODE_DISABLED_MESSAGE };

  const result = resumeProject(ctx.db, projectId, ctx.ownerId);
  revalidatePath("/office");
  revalidatePath(`/office/projects/${projectId}`);
  return result.ok ? {} : { error: result.reason };
}
