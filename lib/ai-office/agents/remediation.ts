import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getTask, listTaskDependencies, listTasksForProject, type TaskRow } from "../domain/tasks.ts";
import { getAgentRole, type AgentRoleRow } from "../domain/agent-roles.ts";

/**
 * Remediation-target resolution for review-role failures.
 *
 * Bug this replaces: AgentRunner used to reopen a failing review task's
 * *direct* dependency, which only happens to be correct for QA (whose
 * direct dependency is the development task). For Security Reviewer and
 * Code Reviewer — whose direct dependency is QA, not the developer —
 * that reopened QA instead of the task that actually needs a code
 * change. See the Phase 4 status note in
 * docs/ai-office/11-implementation-phases.md for the full writeup.
 *
 * Fix: derive "development role" / "review role" from each role's own
 * `allowedInputs`/`allowedOutputs` (already seeded in
 * lib/ai-office/domain/agent-role-catalog.ts) instead of a hardcoded
 * role-id list or graph position:
 * - A **development role** is any role whose `allowedOutputs` includes
 *   `"code"` — works for frontend-developer, backend-developer, and any
 *   future development role seeded the same way, without this file
 *   needing to change.
 * - A **review role** is any role whose `allowedInputs` includes
 *   `"code"` but whose `allowedOutputs` does not — it consumes code to
 *   validate it, without producing more.
 *
 * `findRemediationTargets` then walks the dependency ancestry
 * *backwards* from the failing review task until it finds development-
 * role ancestors, however many hops away — not just the immediate
 * parent. `findStaleDownstreamReviews` finds every already-`DONE`
 * review task that transitively depends on those development tasks —
 * covering both a review step strictly between the development task and
 * the one that just failed (e.g. QA, when Security fails) and an
 * already-passed sibling branch validating the same code (e.g. Security,
 * when Code Review fails after Security already passed) — both need to
 * rerun once the code changes again.
 */

export function isDevelopmentRole(role: AgentRoleRow): boolean {
  return (JSON.parse(role.allowedOutputs) as string[]).includes("code");
}

export function isReviewRole(role: AgentRoleRow): boolean {
  const inputs = JSON.parse(role.allowedInputs) as string[];
  const outputs = JSON.parse(role.allowedOutputs) as string[];
  return inputs.includes("code") && !outputs.includes("code");
}

/**
 * Development-role ancestors of `taskId`, found by walking the
 * dependency graph backwards (BFS, deterministic order) past any number
 * of intermediate review tasks. Falls back to the task's direct
 * dependencies if no development-role ancestor exists anywhere upstream,
 * so a review task with an unusual dependency chain still has a
 * deterministic (if imperfect) remediation target rather than none.
 */
export function findRemediationTargets(db: DatabaseSync, taskId: string): TaskRow[] {
  const visited = new Set<string>([taskId]);
  const foundIds = new Set<string>();
  const found: TaskRow[] = [];
  const queue: string[] = [taskId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const dep of listTaskDependencies(db, currentId)) {
      if (visited.has(dep.dependsOnTaskId)) continue;
      visited.add(dep.dependsOnTaskId);

      const depTask = getTask(db, dep.dependsOnTaskId);
      if (!depTask) continue;
      const depRole = getAgentRole(db, depTask.roleId);

      if (depRole && isDevelopmentRole(depRole)) {
        if (!foundIds.has(depTask.id)) {
          foundIds.add(depTask.id);
          found.push(depTask);
        }
        // Do not walk further back past a development-role ancestor —
        // that task IS the remediation target, not a waypoint to one.
      } else {
        queue.push(depTask.id);
      }
    }
  }

  if (found.length > 0) return found;

  return listTaskDependencies(db, taskId)
    .map((d) => getTask(db, d.dependsOnTaskId))
    .filter((t): t is TaskRow => t !== undefined);
}

function dependsTransitivelyOn(db: DatabaseSync, taskId: string, targetIds: Set<string>): boolean {
  const visited = new Set<string>([taskId]);
  const queue: string[] = [taskId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const dep of listTaskDependencies(db, currentId)) {
      if (targetIds.has(dep.dependsOnTaskId)) return true;
      if (visited.has(dep.dependsOnTaskId)) continue;
      visited.add(dep.dependsOnTaskId);
      queue.push(dep.dependsOnTaskId);
    }
  }
  return false;
}

/**
 * Every review-role task in the project, currently `DONE`, that
 * transitively depends on any of `developmentTaskIds`. These already
 * passed but are now stale — the code they validated is being changed
 * again — and must rerun. The caller is responsible for excluding the
 * task that is itself the current failure (it's handled separately).
 */
export function findStaleDownstreamReviews(
  db: DatabaseSync,
  projectId: string,
  developmentTaskIds: string[],
): TaskRow[] {
  if (developmentTaskIds.length === 0) return [];
  const targetIds = new Set(developmentTaskIds);

  return listTasksForProject(db, projectId).filter((task) => {
    if (task.status !== "DONE") return false;
    const role = getAgentRole(db, task.roleId);
    if (!role || !isReviewRole(role)) return false;
    return dependsTransitivelyOn(db, task.id, targetIds);
  });
}
