import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProject, updateProjectStatus, type ProjectRow, type ProjectStatus } from "../domain/projects.ts";
import { recordEvent } from "../domain/events.ts";
import { recordAuditEntry } from "../domain/events.ts";

/**
 * The single place Pause/Resume legality is decided — per the Phase 6
 * brief's explicit "create a central transition policy instead of
 * scattering status checks through UI actions." A Server Action calls
 * `pauseProject`/`resumeProject` below; neither one, nor any other
 * caller, should ever write `updateProjectStatus(db, id, "PAUSED")`
 * directly — that would bypass this policy.
 *
 * Deliberately narrow: PAUSE is only meaningful from `IN_PROGRESS` (the
 * only status the Runner's eligibility check ever treats as
 * "executing" — pausing anything else has no effect to undo and would
 * only confuse the owner about what "paused" means). RESUME is only
 * meaningful from `PAUSED` — specifically *not* from `BLOCKED`, per the
 * brief's own example ("BLOCKED should not be silently resumed if the
 * underlying block still exists"): a blocked project's block (an
 * escalated task, a pending approval) has its own resolution path
 * (retry, owner approval decision), and a generic "resume" must never
 * paper over that by just flipping the status back to `IN_PROGRESS`
 * regardless of whether the block is actually gone.
 */

export type ProjectTransitionKind = "PAUSE" | "RESUME";

export interface TransitionEvaluation {
  allowed: boolean;
  reason?: string;
  nextStatus?: ProjectStatus;
}

const HUMAN_STATUS: Record<ProjectStatus, string> = {
  DRAFT: "still a draft",
  PLANNING: "still being planned",
  IN_PROGRESS: "in progress",
  BLOCKED: "blocked",
  PAUSED: "already paused",
  READY_FOR_REVIEW: "ready for review",
  APPROVED: "approved",
  FAILED: "failed",
  ARCHIVED: "archived",
};

export function evaluateProjectTransition(current: ProjectStatus, transition: ProjectTransitionKind): TransitionEvaluation {
  if (transition === "PAUSE") {
    if (current === "IN_PROGRESS") return { allowed: true, nextStatus: "PAUSED" };
    return { allowed: false, reason: `Unable to pause this project because it is ${HUMAN_STATUS[current]}.` };
  }

  // RESUME
  if (current === "PAUSED") return { allowed: true, nextStatus: "IN_PROGRESS" };
  if (current === "BLOCKED") {
    return {
      allowed: false,
      reason: "Unable to resume this project because it is blocked — resolve the underlying block (a pending approval or an escalated task) first.",
    };
  }
  return { allowed: false, reason: `Unable to resume this project because it is ${HUMAN_STATUS[current]}, not paused.` };
}

export interface ProjectTransitionResult {
  ok: true;
  project: ProjectRow;
}
export interface ProjectTransitionFailure {
  ok: false;
  reason: string;
}

function applyTransition(
  db: DatabaseSync,
  projectId: string,
  transition: ProjectTransitionKind,
  actorUserId: string,
): ProjectTransitionResult | ProjectTransitionFailure {
  const project = getProject(db, projectId);
  if (!project) return { ok: false, reason: "Project not found." };

  const evaluation = evaluateProjectTransition(project.status, transition);
  if (!evaluation.allowed || !evaluation.nextStatus) {
    return { ok: false, reason: evaluation.reason ?? "This transition is not allowed." };
  }

  const updated = updateProjectStatus(db, projectId, evaluation.nextStatus);

  const eventType = transition === "PAUSE" ? "project.paused" : "project.resumed";
  recordEvent(db, { projectId, type: eventType, payload: {}, actor: actorUserId });
  recordAuditEntry(db, { actor: actorUserId, action: eventType, targetType: "project", targetId: projectId });

  return { ok: true, project: updated };
}

/** Preserves all task/attempt/lease/budget state — only `projects.status` changes; nothing about the project's tasks is touched. Other projects are entirely unaffected (the Runner's eligibility check is already per-project, see eligibility.ts). */
export function pauseProject(db: DatabaseSync, projectId: string, actorUserId: string): ProjectTransitionResult | ProjectTransitionFailure {
  return applyTransition(db, projectId, "PAUSE", actorUserId);
}

/** Resumes from exactly the persisted state a paused project was left in — no task is recreated, no `attemptCount`/lease is reset; the Runner simply becomes able to claim its `PENDING` tasks again on its next cycle. */
export function resumeProject(db: DatabaseSync, projectId: string, actorUserId: string): ProjectTransitionResult | ProjectTransitionFailure {
  return applyTransition(db, projectId, "RESUME", actorUserId);
}
