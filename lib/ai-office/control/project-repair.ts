import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getProject } from "../domain/projects.ts";
import { listTasksForProject, createTaskWithDependencies, insertTaskDependencyRow, listTaskDependencies, type TaskRow } from "../domain/tasks.ts";
import { recordEvent, recordAuditEntry } from "../domain/events.ts";

/**
 * Runner-reliability follow-up, Phase 6 — a real, generic repair for the
 * exact class of planning defect the second AI Office pilot's TaskFlow
 * project hit: the Orchestrator's role-selection classifier (now fixed
 * separately, in role-selection.ts) produced a backend-only task graph
 * for a genuine user-facing app request. That bug is fixed for every
 * *future* plan; an *already-planned* project's task graph is never
 * silently rewritten from scratch — this adds the missing role's real
 * task(s) through the exact same primitives the Orchestrator itself
 * uses (`createTaskWithDependencies`/`insertTaskDependencyRow`), wired
 * into the existing dependency graph the same way they would have been
 * had the Orchestrator selected them at planning time, with a real
 * event + audit entry explaining why. Every existing task, attempt,
 * failure, and event is left completely untouched — this only adds
 * rows, never rewrites or deletes any.
 */

export interface RepairResult {
  added: TaskRow[];
  updatedDependencyEdges: number;
}

/**
 * Adds `ui-ux-agent` + `frontend-developer` tasks to a project whose
 * plan is missing them, wiring dependencies exactly the way
 * `orchestrator.ts`'s own `buildTaskPlan` would have: the new
 * `ui-ux-agent` depends on the project's existing `solution-architect`
 * task (if DONE or otherwise present), the new `frontend-developer`
 * depends on both `solution-architect` and the new `ui-ux-agent`, and
 * any existing `qa-agent` task gets an ADDITIONAL dependency edge on the
 * new `frontend-developer` (alongside whatever it already depended on)
 * — QA must wait for every real development role's output, not just
 * the one that happened to exist when the project was first planned.
 *
 * Idempotent and safe to call more than once: if a frontend-developer
 * task already exists for this project, this is a clean no-op (returns
 * `{ added: [], updatedDependencyEdges: 0 }`), never a duplicate plan.
 */
export function addMissingFrontendRole(db: DatabaseSync, projectId: string, actorId: string): RepairResult {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Cannot repair: project ${projectId} does not exist.`);

  const tasks = listTasksForProject(db, projectId);
  if (tasks.some((t) => t.roleId === "frontend-developer")) {
    return { added: [], updatedDependencyEdges: 0 };
  }

  const architect = tasks.find((t) => t.roleId === "solution-architect");
  const architectDeps = architect ? [architect.id] : [];

  const { task: uiUxTask } = createTaskWithDependencies(db, {
    projectId,
    roleId: "ui-ux-agent",
    title: `Design UX flow — ${project.title}`,
    dependsOnTaskIds: architectDeps,
  });

  const { task: frontendTask } = createTaskWithDependencies(db, {
    projectId,
    roleId: "frontend-developer",
    title: `Implement frontend — ${project.title}`,
    dependsOnTaskIds: [...architectDeps, uiUxTask.id],
  });

  let updatedDependencyEdges = 0;
  const qaTask = tasks.find((t) => t.roleId === "qa-agent");
  if (qaTask) {
    const existingDeps = listTaskDependencies(db, qaTask.id).map((d) => d.dependsOnTaskId);
    if (!existingDeps.includes(frontendTask.id)) {
      insertTaskDependencyRow(db, { id: randomUUID(), taskId: qaTask.id, dependsOnTaskId: frontendTask.id });
      updatedDependencyEdges += 1;
    }
  }

  const reason =
    "Office repair: the original plan omitted frontend-developer for a genuine user-facing app request (an Orchestrator role-selection defect, since fixed for future plans). Added ui-ux-agent and frontend-developer, and made qa-agent depend on the new frontend-developer task too, so QA correctly waits for every real development role's output.";
  recordEvent(db, { projectId, type: "project.plan_repaired", payload: { addedTaskIds: [uiUxTask.id, frontendTask.id], updatedDependencyEdges, reason }, actor: actorId });
  recordAuditEntry(db, { actor: actorId, action: "project.plan_repaired", targetType: "project", targetId: projectId });

  return { added: [uiUxTask, frontendTask], updatedDependencyEdges };
}
