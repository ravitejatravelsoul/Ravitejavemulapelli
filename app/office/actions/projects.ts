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
});

export interface CreateProjectState {
  error?: string;
}

/**
 * Idea in, planned project out — the only thing this does beyond
 * validating and persisting is call the existing, already-tested
 * `planProject()` (Phase 5's deterministic Orchestrator). Always
 * SIMULATED (`createProjectWithIdea`'s `aiMode` defaults to
 * `"SIMULATED"` when omitted here — never set explicitly to `"LIVE"`
 * from this form). No AI is called; planning is a deterministic
 * keyword classifier, not a model.
 */
export async function createProjectAction(_prevState: CreateProjectState | undefined, formData: FormData): Promise<CreateProjectState> {
  const session = await verifySession();
  if (!session) return { error: "You must be signed in." };

  const parsed = newProjectSchema.safeParse({
    title: formData.get("title"),
    ideaText: formData.get("ideaText"),
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
  const ctx = await withOwnerSession();
  if ("error" in ctx) return ctx;
  if (typeof projectId !== "string" || projectId.length === 0) return { error: "Invalid project." };

  const result = pauseProject(ctx.db, projectId, ctx.ownerId);
  revalidatePath("/office");
  revalidatePath(`/office/projects/${projectId}`);
  return result.ok ? {} : { error: result.reason };
}

export async function resumeProjectAction(projectId: string): Promise<ProjectTransitionActionState> {
  const ctx = await withOwnerSession();
  if ("error" in ctx) return ctx;
  if (typeof projectId !== "string" || projectId.length === 0) return { error: "Invalid project." };

  const result = resumeProject(ctx.db, projectId, ctx.ownerId);
  revalidatePath("/office");
  revalidatePath(`/office/projects/${projectId}`);
  return result.ok ? {} : { error: result.reason };
}
