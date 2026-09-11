import "server-only";
import type { DatabaseSync } from "node:sqlite";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AgentRoleRow } from "../domain/agent-roles.ts";
import type { TaskRow } from "../domain/tasks.ts";
import { listArtifactsForProject, listDecisionsForProject } from "../domain/project-outputs.ts";
import { getProjectMemory } from "../domain/project-memory.ts";
import type { TaskContext } from "../providers/types.ts";

/**
 * Builds the scoped `TaskContext` a role is allowed to see, strictly
 * from that role's own `allowedInputs` tags (seeded in
 * lib/ai-office/domain/agent-role-catalog.ts) — never the whole
 * project. This is the concrete mechanism behind
 * docs/ai-office/04-agent-architecture.md §2's "Scoped context"
 * requirement and docs/ai-office/06-data-model.md §7's "don't reread
 * everything" cost control.
 *
 * Deliberately reads only `artifacts`/`project_decisions`/
 * `project_memory_cache` — never `budget_records`, `ai_usage`, or
 * `users` — so there is no code path by which budget internals or
 * credentials could ever end up in a role's context, regardless of
 * what's in `allowedInputs`.
 */
export function buildTaskContext(
  db: DatabaseSync,
  task: TaskRow,
  role: AgentRoleRow,
  options: { scenario?: string } = {},
): TaskContext {
  const allowedInputs: string[] = JSON.parse(role.allowedInputs);
  const allArtifacts = listArtifactsForProject(db, task.projectId);

  // Latest artifact per allowed type only — a role never sees artifact
  // types outside its own allowedInputs.
  const relevantArtifacts = allowedInputs
    .map((tag) => {
      const matches = allArtifacts.filter((a) => a.type === tag);
      return matches.length > 0 ? matches[matches.length - 1] : undefined;
    })
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
    .map((a) => ({ type: a.type, content: a.content }));

  const relevantDecisions = allowedInputs.includes("project-memory")
    ? listDecisionsForProject(db, task.projectId).map((d) => ({ type: d.type, summary: d.summary }))
    : [];

  const memory = allowedInputs.includes("project-memory") ? getProjectMemory(db, task.projectId) : undefined;

  return {
    projectId: task.projectId,
    taskId: task.id,
    roleId: role.id,
    taskTitle: task.title,
    projectSummary: memory?.summary ?? "",
    relevantArtifacts,
    relevantDecisions,
    scenario: options.scenario,
  };
}
