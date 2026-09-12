import "server-only";
import type { DatabaseSync } from "node:sqlite";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AgentRoleRow } from "../domain/agent-roles.ts";
import type { TaskRow } from "../domain/tasks.ts";
import { listArtifactsForProject, listDecisionsForProject, listUnresolvedFailures } from "../domain/project-outputs.ts";
import { getProjectMemory } from "../domain/project-memory.ts";
import { getProject, getProjectIdea } from "../domain/projects.ts";
import type { TaskContext, RemediationContext } from "../providers/types.ts";
import { workspaceExists, listFiles, readFile } from "../workspace/workspace-service.ts";
import { isDevelopmentRole } from "./remediation.ts";

/** Fixed, idea-independent — never redescribes what this specific project builds. */
const PRESERVE_REQUIREMENTS_GUIDANCE =
  "This is a corrective attempt, not a redesign. The authoritative user request has not changed. Preserve all existing content and behavior that the failure reason does not mention — do not rename, retheme, or reinterpret the product, and do not replace working UI/content unless the failure genuinely requires it. Prefer changing only the file(s) most directly related to the reported failure (e.g. if the failure describes broken interactive behavior, prefer editing the script over rewriting the markup/styles) — but you may rewrite whichever file(s) are actually necessary to fix it.";

/** All current real workspace files, unabridged by role — a corrective attempt needs to see exactly what already exists to preserve it, not just the subset its own allowedInputs would normally scope it to. */
async function buildCurrentFiles(projectId: string): Promise<Array<{ path: string; content: string }>> {
  if (!workspaceExists(projectId)) return [];
  const paths = await listFiles(projectId);
  const files: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    files.push({ path, content: await readFile(projectId, path) });
  }
  return files;
}

/**
 * Built only when this execution is a genuine corrective attempt for a
 * development role — reuses exactly the Failure/workspace data every
 * other remediation path already persists (`listUnresolvedFailures`,
 * `workspace-service.ts`'s real file reads), never a new tracking
 * mechanism. See `RemediationContext`'s docblock in providers/types.ts
 * for why this exists.
 */
async function buildRemediationContext(
  db: DatabaseSync,
  task: TaskRow,
  role: AgentRoleRow,
  attemptNumber: number,
): Promise<RemediationContext | undefined> {
  if (attemptNumber <= 1 || !isDevelopmentRole(role)) return undefined;

  const failingChecks = listUnresolvedFailures(db, task.projectId)
    .filter((f) => f.taskId === task.id)
    .map((f) => f.reason);

  return {
    attemptNumber,
    failureReason: failingChecks[failingChecks.length - 1] ?? null,
    failingChecks,
    currentFiles: await buildCurrentFiles(task.projectId),
    preserveRequirements: PRESERVE_REQUIREMENTS_GUIDANCE,
  };
}

/** A scoped sample, not the whole workspace — Phase 8 Part J's "file list, relevant changed files, selected content... never the whole workspace blindly." */
const MAX_RELEVANT_FILES = 8;
const MAX_RELEVANT_FILE_CONTENT_CHARS = 4000;

async function buildRelevantFiles(projectId: string): Promise<Array<{ path: string; content: string }>> {
  if (!workspaceExists(projectId)) return [];
  const paths = (await listFiles(projectId)).slice(0, MAX_RELEVANT_FILES);
  const files: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    const content = await readFile(projectId, path);
    files.push({ path, content: content.slice(0, MAX_RELEVANT_FILE_CONTENT_CHARS) });
  }
  return files;
}

/**
 * `SimulatedAdapter`'s fixture scenario ("success"/"failure"/
 * "retry-success") when nothing explicitly overrides it. Real runner
 * operation never passes `options.scenario` at all (only tests do) —
 * without this default, every real run would always resolve to
 * "success", so a role with a distinct retry-success fixture (today,
 * `frontend-developer`) could never naturally exercise its fix-attempt
 * content outside a test harness. Deterministic, not random: purely a
 * function of which attempt this is. `OllamaAdapter`/future real
 * providers ignore `scenario` entirely, so this default is inert for
 * them either way.
 */
function defaultScenarioForAttempt(attemptNumber: number | undefined): string | undefined {
  if (attemptNumber === undefined || attemptNumber <= 1) return undefined; // undefined resolves to "success" in fixtures.ts
  return "retry-success";
}

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
export async function buildTaskContext(
  db: DatabaseSync,
  task: TaskRow,
  role: AgentRoleRow,
  options: { scenario?: string; attemptNumber?: number } = {},
): Promise<TaskContext> {
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
  const relevantFiles = allowedInputs.includes("code") ? await buildRelevantFiles(task.projectId) : [];

  // Unconditional, unlike everything else above — every role serves the
  // original request, so unlike artifacts/decisions/files (which are
  // legitimately scoped by allowedInputs), the request itself is never
  // scoped away. See TaskContext.authoritativeUserRequest's docblock.
  const idea = getProjectIdea(db, task.projectId);
  const project = getProject(db, task.projectId);
  const remediationContext = await buildRemediationContext(db, task, role, options.attemptNumber ?? 1);

  return {
    projectId: task.projectId,
    taskId: task.id,
    roleId: role.id,
    taskTitle: task.title,
    projectSummary: memory?.summary ?? "",
    authoritativeUserRequest: idea?.rawText ?? "",
    projectTitle: project?.title ?? "",
    remediationContext,
    relevantArtifacts,
    relevantDecisions,
    relevantFiles,
    scenario: options.scenario ?? defaultScenarioForAttempt(options.attemptNumber),
  };
}
