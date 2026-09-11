import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { getProject, updateProjectStatus, type ProjectRow } from "../domain/projects.ts";
import { getProjectIdea } from "../domain/projects.ts";
import { insertTaskRow, insertTaskDependencyRow, getTask, type TaskRow } from "../domain/tasks.ts";
import { recordDecision, createApproval } from "../domain/project-outputs.ts";
import { recordEvent } from "../domain/events.ts";
import { refreshProjectMemory } from "../domain/project-memory.ts";
import { selectRoles, requiresOwnerApproval } from "./role-selection.ts";
import { validateTaskGraph, type PlanTaskNode } from "./graph.ts";

/**
 * The real Phase 5 Orchestrator — deterministic orchestration
 * *mechanics*, not AI. Given a Project + ProjectIdea, decides which
 * approved roles are required (role-selection.ts) and builds the task
 * DAG accordingly (this file), all inside one transaction so a partial
 * plan is never left behind if planning fails partway through. See
 * docs/ai-office/05-orchestration-workflow.md §1–§4.
 */

export interface PlanProjectResult {
  project: ProjectRow;
  tasks: TaskRow[];
  selectedRoles: string[];
  rationale: string[];
  approvalRequired: boolean;
}

/**
 * Builds the in-memory task graph for a selected role set. Dependency
 * shape mirrors docs/ai-office/04-agent-architecture.md §1's "Typical
 * inputs" column: Product -> [Research] -> Architecture -> [UI/UX] ->
 * [Frontend]/Backend -> QA -> [Security]/Code Review -> Release. Roles
 * not selected are simply absent from the graph; every present role's
 * dependencies are recomputed against whichever *other* roles actually
 * exist in this plan, so removing an optional role never leaves a
 * dangling reference.
 */
function buildTaskPlan(roles: string[], ideaTitle: string): PlanTaskNode[] {
  const has = (roleId: string) => roles.includes(roleId);
  const idFor = new Map<string, string>();
  for (const roleId of roles) idFor.set(roleId, randomUUID());

  const nodes: PlanTaskNode[] = [];
  const titleFor: Record<string, string> = {
    "product-owner": `Define requirements — ${ideaTitle}`,
    "research-agent": `Research prior art — ${ideaTitle}`,
    "solution-architect": `Design architecture — ${ideaTitle}`,
    "ui-ux-agent": `Design UX flow — ${ideaTitle}`,
    "frontend-developer": `Implement frontend — ${ideaTitle}`,
    "backend-developer": `Implement backend — ${ideaTitle}`,
    "qa-agent": `Test — ${ideaTitle}`,
    "security-reviewer": `Security review — ${ideaTitle}`,
    "code-reviewer": `Code review — ${ideaTitle}`,
    "release-agent": `Prepare release — ${ideaTitle}`,
  };

  function add(roleId: string, dependsOn: string[]) {
    if (!has(roleId)) return;
    nodes.push({ id: idFor.get(roleId)!, roleId, title: titleFor[roleId] ?? `${roleId} — ${ideaTitle}`, dependsOn });
  }

  add("product-owner", []);
  add("research-agent", has("product-owner") ? [idFor.get("product-owner")!] : []);
  const architectDeps = has("research-agent")
    ? [idFor.get("research-agent")!]
    : has("product-owner")
      ? [idFor.get("product-owner")!]
      : [];
  add("solution-architect", architectDeps);
  const architectId = has("solution-architect") ? idFor.get("solution-architect")! : undefined;
  add("ui-ux-agent", architectId ? [architectId] : []);

  const frontendDeps: string[] = [];
  if (architectId) frontendDeps.push(architectId);
  if (has("ui-ux-agent")) frontendDeps.push(idFor.get("ui-ux-agent")!);
  add("frontend-developer", frontendDeps);

  add("backend-developer", architectId ? [architectId] : []);

  const developerIds = [has("frontend-developer") ? idFor.get("frontend-developer") : undefined, has("backend-developer") ? idFor.get("backend-developer") : undefined].filter(
    (id): id is string => !!id,
  );
  add("qa-agent", developerIds);

  const qaId = has("qa-agent") ? idFor.get("qa-agent")! : undefined;
  add("security-reviewer", qaId ? [qaId] : []);
  add("code-reviewer", qaId ? [qaId] : []);

  const releaseDeps = [has("security-reviewer") ? idFor.get("security-reviewer") : undefined, has("code-reviewer") ? idFor.get("code-reviewer") : undefined].filter(
    (id): id is string => !!id,
  );
  add("release-agent", releaseDeps);

  return nodes;
}

/**
 * Plans a project: selects roles, builds and validates the task DAG,
 * then persists everything (tasks, dependencies, the planning rationale
 * as a decision, an approval row if the synthetic approval-required
 * signal fires) in a single transaction. Throws — leaving nothing
 * persisted — if the idea has already been planned (has tasks) or if
 * the constructed graph somehow fails validation (a defensive
 * safety net; the construction algorithm above never produces an
 * invalid graph, but this is checked anyway rather than trusted
 * blindly, per the Phase 5 brief).
 */
export function planProject(db: DatabaseSync, projectId: string): PlanProjectResult {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Cannot plan: project ${projectId} does not exist.`);
  if (project.status !== "DRAFT") {
    throw new Error(`Cannot plan project ${projectId}: status is ${project.status}, expected DRAFT.`);
  }

  const idea = getProjectIdea(db, projectId);
  if (!idea) throw new Error(`Cannot plan: project ${projectId} has no ProjectIdea.`);

  const { roles, rationale } = selectRoles(idea.rawText);
  const planNodes = buildTaskPlan(roles, project.title);

  const validation = validateTaskGraph(planNodes);
  if (!validation.valid) {
    throw new Error(`Refusing to plan project ${projectId}: ${validation.reason}`);
  }

  const approval = requiresOwnerApproval(idea.rawText);

  db.exec("BEGIN");
  try {
    for (const node of planNodes) {
      insertTaskRow(db, { id: node.id, projectId, roleId: node.roleId, title: node.title });
    }
    for (const node of planNodes) {
      for (const dependsOnId of node.dependsOn) {
        insertTaskDependencyRow(db, { id: randomUUID(), taskId: node.id, dependsOnTaskId: dependsOnId });
      }
    }

    recordDecision(db, {
      projectId,
      type: "decision",
      summary: `Orchestrator selected roles: ${roles.join(", ")}.`,
      rationale: rationale.join(" "),
      madeBy: "orchestrator",
    });

    if (approval.required) {
      createApproval(db, {
        projectId,
        kind: "paid_service_purchase",
        requestedBy: "orchestrator",
        context: { reason: `Idea text matched a synthetic approval-required signal: "${approval.matchedSignal}".` },
      });
      updateProjectStatus(db, projectId, "BLOCKED");
      recordEvent(db, {
        projectId,
        type: "approval.required",
        payload: { matchedSignal: approval.matchedSignal },
        actor: "orchestrator",
      });
    } else {
      updateProjectStatus(db, projectId, "IN_PROGRESS");
    }

    recordEvent(db, {
      projectId,
      type: "project.planned",
      payload: { roles, taskCount: planNodes.length },
      actor: "orchestrator",
    });

    refreshProjectMemory(db, projectId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const tasks = planNodes.map((n) => getTask(db, n.id)).filter((t): t is TaskRow => !!t);
  return {
    project: getProject(db, projectId) as ProjectRow,
    tasks,
    selectedRoles: roles,
    rationale,
    approvalRequired: approval.required,
  };
}
