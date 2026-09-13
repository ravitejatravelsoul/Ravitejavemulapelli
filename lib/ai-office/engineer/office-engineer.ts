import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listProjects } from "../domain/projects.ts";
import { listTasksForProject, type TaskRow } from "../domain/tasks.ts";
import { listFailuresForTask } from "../domain/project-outputs.ts";
import { isOperationalFailureReason } from "../agents/failure-classification.ts";
import { retryEscalatedTask } from "../control/task-transitions.ts";
import {
  createIncident,
  updateIncident,
  findOpenIncidentFor,
  listOpenIncidents,
  type OfficeIncidentRow,
  type OfficeIncidentStatus,
} from "../domain/office-incidents.ts";
import { recordEvent, recordAuditEntry } from "../domain/events.ts";

/**
 * Office Engineer — Teja's AI Office's own self-healing maintenance
 * agent (platform-hardening phase, Parts 9-11). NOT a project role: it
 * never enters a project's own task DAG (`agent_roles`/`tasks`), it
 * watches the platform itself.
 *
 * Deterministic and free by design — "Health detection itself should be
 * deterministic/free. Only invoke AI when diagnosis/repair genuinely
 * requires it," per the brief this closes. This first version never
 * calls any AI provider at all: every symptom it currently knows how to
 * diagnose (a task blocked by a run of purely operational failures —
 * timeouts, malformed/truncated provider JSON, transient connection
 * errors) has a real, safe, already-tested deterministic repair: retry
 * it via the same owner-facing `retryEscalatedTask` capability, which
 * itself still runs through every existing approval/budget/context
 * gate on its next real attempt — this agent never bypasses any of
 * those, it only grants a fresh attempt window, exactly like an owner
 * clicking "Retry" would.
 *
 * A task blocked by even one SEMANTIC failure (a real content/logic
 * problem an operational retry can't fix) is deliberately never
 * auto-repaired — it's escalated for owner attention instead. Routing
 * a semantic failure's diagnosis/repair to a real AI provider is a real,
 * described extension point (see `ESCALATED_NEEDS_AI_DIAGNOSIS` below),
 * not implemented or exercised here: doing so would mean this agent
 * autonomously initiating a paid call, which this phase's own brief
 * explicitly forbids ("Do NOT start another paid pilot yet") and which,
 * even once enabled, must still obey the exact same approval/budget/
 * context/usage/audit/retry protections as every other real provider
 * call in this codebase — never a separate, weaker path.
 */

export type OfficeHealthStatus = "HEALTHY" | "WATCHING" | "INVESTIGATING" | "REPAIRING" | "ESCALATED";

const STATUS_PRIORITY: Record<OfficeIncidentStatus, number> = {
  ESCALATED: 5,
  REPAIRING: 4,
  VERIFYING: 4,
  INVESTIGATING: 3,
  WATCHING: 2,
  RESOLVED: 0,
};

/**
 * Pure read, safe to call from anywhere (including a Next.js Server
 * Component render) — the office's overall status is always just a
 * reduction over its own real, persisted open incidents, never a
 * separate live re-check (that's what `runOfficeEngineerCycle` is for,
 * and it only ever runs from the trusted single-writer runner process).
 */
export function computeOfficeHealthStatus(db: DatabaseSync): OfficeHealthStatus {
  const open = listOpenIncidents(db);
  if (open.length === 0) return "HEALTHY";
  const worst = open.reduce((max, i) => Math.max(max, STATUS_PRIORITY[i.status]), 0);
  return (Object.entries(STATUS_PRIORITY).find(([, p]) => p === worst)?.[0] as OfficeHealthStatus) ?? "WATCHING";
}

const SYMPTOM_BLOCKED_TASK = "task-blocked";

function diagnoseBlockedTask(db: DatabaseSync, task: TaskRow): { operational: boolean; reasons: string[] } {
  // The failures recorded since this task's own baseline (or all of them
  // if it's never been retried) — exactly the same evidence a human
  // clicking "Retry" would themselves want to read first.
  const failures = listFailuresForTask(db, task.id).filter((f) => !f.resolved);
  const reasons = failures.length > 0 ? failures.map((f) => f.reason) : ["(no failure reason recorded)"];
  const operational = failures.length > 0 && failures.every((f) => isOperationalFailureReason(f.reason));
  return { operational, reasons };
}

/**
 * The one real, bounded auto-repair this version performs, run once per
 * standalone-runner poll cycle (cheap: a handful of SELECT queries plus,
 * at most, one write per genuinely new incident — never a per-tick cost
 * that scales with anything but the number of real problems found).
 */
export function runOfficeEngineerCycle(db: DatabaseSync, actorId = "office-engineer"): { incidentsCreated: number; repaired: number; escalated: number } {
  let incidentsCreated = 0;
  let repaired = 0;
  let escalated = 0;

  const blockedProjects = listProjects(db, { status: "BLOCKED" });
  for (const project of blockedProjects) {
    const blockedTasks = listTasksForProject(db, project.id).filter((t) => t.status === "BLOCKED");
    for (const task of blockedTasks) {
      if (findOpenIncidentFor(db, { projectId: project.id, taskId: task.id, symptom: SYMPTOM_BLOCKED_TASK })) continue; // already being tracked — never spam duplicate incidents for the same still-open problem

      const { operational, reasons } = diagnoseBlockedTask(db, task);
      let incident: OfficeIncidentRow = createIncident(db, {
        symptom: SYMPTOM_BLOCKED_TASK,
        projectId: project.id,
        taskId: task.id,
        status: "INVESTIGATING",
        diagnosis: `Task "${task.title}" (role ${task.roleId}) exhausted its retry ceiling. Recent failure reason(s): ${reasons.join(" | ")}`,
      });
      incidentsCreated += 1;

      if (!operational) {
        // A real content/logic problem — never auto-retried. The owner
        // decides (fix the deliverable's requirements, or retry manually
        // once they believe it's actually fixable) via the same Retry
        // control this agent itself would use.
        incident = updateIncident(db, incident.id, {
          status: "ESCALATED",
          diagnosis: `${incident.diagnosis} — at least one failure is a real content/logic problem, not a transient one; this needs owner judgment, not an automatic retry.`,
        });
        recordEvent(db, { projectId: project.id, type: "office_engineer.escalated", payload: { taskId: task.id, incidentId: incident.id }, actor: actorId });
        escalated += 1;
        continue;
      }

      incident = updateIncident(db, incident.id, { status: "REPAIRING", repairAction: "retryEscalatedTask (every recent failure was operational/transient)" });
      recordEvent(db, { projectId: project.id, type: "office_engineer.repairing", payload: { taskId: task.id, incidentId: incident.id }, actor: actorId });

      const result = retryEscalatedTask(db, task.id, actorId, "Office Engineer: auto-retried after diagnosing every recent failure as operational/transient, never a content problem.");
      if (result.ok) {
        updateIncident(db, incident.id, { status: "RESOLVED", retryResult: "Task returned to PENDING for a fresh attempt.", resolvedAt: Date.now() });
        recordAuditEntry(db, { actor: actorId, action: "office_engineer.auto_retry", targetType: "task", targetId: task.id });
        repaired += 1;
      } else {
        // Should be rare (the task was BLOCKED a moment ago and nothing
        // else in this single-writer cycle could have changed that) —
        // if it does happen, this is exactly what ESCALATED is for.
        updateIncident(db, incident.id, { status: "ESCALATED", retryResult: result.reason, resolvedAt: null });
        escalated += 1;
      }
    }
  }

  return { incidentsCreated, repaired, escalated };
}

/**
 * Extension point, deliberately unimplemented in this phase — routing a
 * SEMANTIC (content/logic) failure's diagnosis to a real AI provider
 * would let Office Engineer repair more than transient operational
 * hiccups, but doing so means it would be the one *initiating* a paid
 * call rather than the owner. Before this is ever wired up for real, it
 * must go through the exact same `prepareClaudeCall`-style approval/
 * budget/context gate every other Claude call in this codebase already
 * does — never a separate, weaker path just because the caller is this
 * agent instead of a project role.
 */
export const ESCALATED_NEEDS_AI_DIAGNOSIS = "escalated-needs-ai-diagnosis" as const;
