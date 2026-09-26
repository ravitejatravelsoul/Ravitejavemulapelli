import "server-only";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getOfficeFloorView } from "../dashboard/office-floor-data.ts";
import { getOfficeInteractionView } from "../dashboard/office-interaction-data.ts";
import {
  getOfficeOverview,
  getBudgetView,
  getPendingApprovalsView,
  getRunnerActivityView,
} from "../dashboard/dashboard-data.ts";
import {
  listTasksForProject,
  listTaskDependencies,
  listTaskAttempts,
  getAgentRun,
  type TaskRow,
} from "../domain/tasks.ts";
import { listProjects } from "../domain/projects.ts";
import { getWorkspace, listWorkspaceFileRecords, type WorkspaceFileRow } from "../domain/workspace.ts";
import { listFailuresForTask, listArtifactsForProject, listTestResultsForTask, type ArtifactRow } from "../domain/project-outputs.ts";
import { listRecentIncidents } from "../domain/office-incidents.ts";
import { computeOfficeHealthStatus } from "../engineer/office-engineer.ts";
import {
  listModelRegistryEntries,
  listRoutingDecisions,
  isProviderEnabled,
} from "../domain/model-registry.ts";
import { getFreeEligibility } from "../providers/free/free-provider-config.ts";
import { listAiUsageForProject } from "../domain/budget.ts";

/** Only public display fields enter this boundary. Raw outputs/prompts, contexts,
 * diagnoses, file contents and event payloads never leave it. Defense in depth
 * also removes configured secrets accidentally embedded in a display title. */
export function safeWorldText(value: unknown, limit = 220): string {
  let text = typeof value === "string" ? value : "";
  for (const [key, secret] of Object.entries(process.env))
    if (
      /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(key) &&
      secret &&
      secret.length >= 8
    )
      text = text.split(secret).join("[redacted]");
  return text
    .replace(/(?:sk-|gsk_|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, limit);
}
const ARTIFACT_LABEL: Record<string, string> = {
  requirements: "a requirements document",
  architecture: "an architecture plan",
  "ux-spec": "a UX flow specification",
  code: "an implementation note",
  "test-report": "a test report",
  "security-report": "a security report",
  "review-notes": "code review notes",
  "release-summary": "a release summary",
  "research-notes": "research notes",
};

/** Facts about a role's finished task, all read from persisted state — artifact types/sizes, files it wrote, its recorded run and any real test result. No model output text is copied, so nothing here can be invented or leak raw content. */
function completedWorkFor(
  db: DatabaseSync,
  task: TaskRow,
  artifacts: ArtifactRow[],
  files: WorkspaceFileRow[],
  deliveryState: string,
) {
  const succeeded = listTaskAttempts(db, task.id).flatMap((a) => {
    const r = a.agentRunId ? getAgentRun(db, a.agentRunId) : null;
    return r?.status === "SUCCEEDED" ? [{ r, attempt: a.attemptNumber }] : [];
  });
  const last = succeeded.at(-1);
  const test = listTestResultsForTask(db, task.id).at(-1);
  return {
    taskTitle: safeWorldText(task.title),
    finishedAt: last?.r.finishedAt ?? task.updatedAt,
    attempt: last?.attempt ?? task.attemptCount,
    provider: last ? safeWorldText(last.r.provider) : null,
    model: last ? safeWorldText(last.r.model) || null : null,
    deliverables: artifacts
      .filter((x) => x.taskId === task.id)
      .map((x) => ({ label: ARTIFACT_LABEL[x.type] ?? "a " + safeWorldText(x.type, 40), characters: x.content.length })),
    files: files.filter((f) => f.lastModifiedByTaskId === task.id).map((f) => safeWorldText(f.path, 80)).slice(0, 12),
    test: test ? { status: test.status, summary: safeWorldText(test.summary, 180) } : null,
    delivery: task.roleId === "release-agent" ? deliveryState : null,
  };
}

export function getAIHeadquartersWorldState(
  db: DatabaseSync,
  projectId?: string,
  mode: "local" | "remote" = "local",
  now = Date.now(),
) {
  const floor = getOfficeFloorView(db, projectId, now),
    interaction = getOfficeInteractionView(db, floor, now),
    overview = getOfficeOverview(db),
    budget = getBudgetView(db);
  const project = floor.selectedProject,
    tasks = project ? listTasksForProject(db, project.id) : [],
    usage = project ? listAiUsageForProject(db, project.id) : [];
  const approvals = getPendingApprovalsView(db)
    .slice(0, 100)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      projectId: a.projectId,
      projectTitle: safeWorldText(a.projectTitle),
      taskId: a.taskId,
      taskTitle: safeWorldText(a.taskTitle),
      requestedBy: safeWorldText(a.requestedBy),
      createdAt: a.createdAt,
      scopeLabel: safeWorldText(a.scopeLabel),
      reason: safeWorldText(a.reason),
      estimatedCostUsd: a.estimatedCostUsd ?? null,
      escalationStatus: safeWorldText(a.escalationStatus),
    }));
  const projectArtifacts = project ? listArtifactsForProject(db, project.id) : [],
    projectFiles = project ? listWorkspaceFileRecords(db, project.id) : [];
  const agents = floor.agents.map((a) => {
    const task = tasks.find((t) => t.id === a.taskId),
      failure = task
        ? listFailuresForTask(db, task.id)
            .filter((f) => !f.resolved)
            .at(-1)
        : null;
    const waitingOn = task
      ? listTaskDependencies(db, task.id).flatMap((d) => {
          const t = tasks.find((t) => t.id === d.dependsOnTaskId);
          return t && t.status !== "DONE" ? [safeWorldText(t.title)] : [];
        })
      : [];
    const attempts = task ? listTaskAttempts(db, task.id) : [];
    const runs = attempts.flatMap((a) => {
      const r = a.agentRunId ? getAgentRun(db, a.agentRunId) : null;
      return r
        ? [
            {
              id: r.id,
              status: r.status,
              provider: safeWorldText(r.provider),
              model: safeWorldText(r.model) || null,
              startedAt: r.startedAt,
              finishedAt: r.finishedAt,
              attempt: a.attemptNumber,
            },
          ]
        : [];
    });
    const ids = new Set(runs.map((r) => r.id)),
      ownUsage = usage.filter((u) => ids.has(u.agentRunId));
    const ownTasks = tasks.filter((t) => t.roleId === a.roleId),
      finished = ownTasks.filter((t) => t.status === "DONE").sort((x, y) => y.updatedAt - x.updatedAt)[0];
    return {
      roleId: a.roleId,
      name: safeWorldText(a.roleName),
      participating: ownTasks.length > 0,
      completedWork: finished
        ? completedWorkFor(db, finished, projectArtifacts, projectFiles, interaction?.deliveryState ?? "NOT_STARTED")
        : null,
      status: a.status,
      taskId: task?.id ?? null,
      task: safeWorldText(a.currentTaskTitle) || null,
      lastCompletedTask: safeWorldText(a.lastCompletedTaskTitle) || null,
      provider: safeWorldText(a.provider) || null,
      model: safeWorldText(a.model) || null,
      attempt: a.attemptCount,
      maxAttempts: a.maxAttempts ?? null,
      blocker: failure
        ? "A recorded task failure needs review. Open Workspace for its authorized details."
        : a.status === "BLOCKED"
          ? "Task is blocked; inspect workspace for details."
          : a.status === "WAITING" &&
              approvals.some((p) => p.projectId === project?.id)
            ? "Waiting for owner approval"
            : null,
      waitingOn,
      runs: runs.slice(-8),
      tokens: ownUsage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0),
      costUsd: ownUsage.length
        ? ownUsage.reduce((n, u) => n + u.costUsd, 0)
        : null,
    };
  });
  const projects = listProjects(db)
    .slice(0, 100)
    .map((p) => ({
      id: p.id,
      title: safeWorldText(p.title),
      status: p.status,
    }));
  const deliveries = listProjects(db)
    .flatMap((p) => {
      const w = getWorkspace(db, p.id),
        t = listTasksForProject(db, p.id);
      if (
        w?.deliveryState !== "VERIFIED" ||
        !["READY_FOR_REVIEW", "APPROVED"].includes(p.status) ||
        !t.length ||
        t.some((t) => t.status !== "DONE")
      )
        return [];
      const u = listAiUsageForProject(db, p.id);
      return [
        {
          id: p.id,
          title: safeWorldText(p.title),
          status: "VERIFIED" as const,
          completedAt: p.updatedAt,
          agents: new Set(t.map((t) => t.roleId)).size,
          models: [
            ...new Set(
              u.flatMap((x) => {
                const r = getAgentRun(db, x.agentRunId);
                return r
                  ? [
                      safeWorldText(
                        r.provider + " / " + (r.model ?? "not recorded"),
                      ),
                    ]
                  : [];
              }),
            ),
          ],
          costUsd: u.reduce((n, x) => n + x.costUsd, 0),
        },
      ];
    })
    .sort((a, b) => b.completedAt - a.completedAt);
  const incidents = listRecentIncidents(db, 30).map((i) => ({
    id: i.id,
    status: i.status,
    symptom: safeWorldText(i.symptom),
    projectId: i.projectId,
    taskId: i.taskId,
    detectedAt: i.detectedAt,
    resolvedAt: i.resolvedAt,
  }));
  const models = listModelRegistryEntries(db)
    .slice(0, 100)
    .map((m) => ({
      id: m.id,
      provider: safeWorldText(m.provider),
      model: safeWorldText(m.modelId),
      eligibility: m.freeTier
        ? getFreeEligibility(m.provider, m.modelId)
        : null,
      enabled: !!m.enabled && isProviderEnabled(db, m.provider),
      health: m.health,
      qualified: !!m.qualified,
      capabilities: (() => {
        try {
          return (JSON.parse(m.capabilities) as unknown[])
            .filter((x) => typeof x === "string")
            .map((x) => safeWorldText(x, 60))
            .slice(0, 12);
        } catch {
          return [];
        }
      })(),
      rateLimitedUntil: m.rateLimitedUntil,
      coolingDown: m.rateLimitedUntil !== null && m.rateLimitedUntil > now,
      lastUsedAt: m.lastUsedAt,
      succeeded: m.tasksCompleted,
      failed: m.tasksFailed,
    }));
  const routing = project
    ? listRoutingDecisions(db, { projectId: project.id, limit: 20 }).map(
        (r) => ({
          id: r.id,
          roleId: r.roleId,
          provider: safeWorldText(r.selectedProvider),
          model: safeWorldText(r.selectedModel),
          attempts: r.attempts,
          fallbacks: (() => {
            try {
              const rows: unknown = JSON.parse(r.fallbacksUsed ?? "[]");
              return Array.isArray(rows)
                ? rows.slice(0, 12).flatMap((x) =>
                    x &&
                    typeof x === "object" &&
                    typeof x.provider === "string" &&
                    typeof x.modelId === "string"
                      ? [
                          {
                            provider: safeWorldText(x.provider),
                            model: safeWorldText(x.modelId),
                          },
                        ]
                      : [],
                  )
                : [];
            } catch {
              return [];
            }
          })(),
          result: r.result,
          costUsd: r.costUsd,
          at: r.createdAt,
        }),
      )
    : [];
  const transitions = (interaction?.transitions ?? []).map((t) => ({
    ...t,
    label: safeWorldText(t.label),
  }));
  const events = project
    ? (
        db
          .prepare(
            "SELECT id,type,actor,occurredAt FROM messages_events WHERE projectId=? ORDER BY occurredAt DESC LIMIT 100",
          )
          .all(project.id) as {
          id: string;
          type: string;
          actor: string;
          occurredAt: number;
        }[]
      )
        .filter((e) =>
          /^(project\.(created|planned|ready_for_review)|task\.(assigned|started|completed)|agent_run\.(started|succeeded|failed)|approval\.(requested|approved|rejected))$/.test(
            e.type,
          ),
        )
        .map((e) => ({
          id: e.id,
          type: e.type,
          roleId: agents.some((a) => a.roleId === e.actor) ? e.actor : null,
          at: e.occurredAt,
          message: safeWorldText(
            e.type.replaceAll(".", " ").replaceAll("_", " "),
          ),
        }))
    : [];
  const state = {
    mode,
    office: {
      state: overview.officeState,
      runner:
        mode === "remote"
          ? "REMOTE_SNAPSHOT"
          : getRunnerActivityView(db, now).runnerStatus,
      health: computeOfficeHealthStatus(db),
      activeProjects: overview.activeProjects,
    },
    project: project
      ? {
          id: project.id,
          title: safeWorldText(project.title),
          status: project.status,
          label: safeWorldText(project.displayStatusLabel),
          completed: project.progress.completed,
          total: project.progress.total,
          deliveryState: interaction?.deliveryState ?? "NOT_STARTED",
          costUsd: usage.reduce((n, u) => n + u.costUsd, 0),
        }
      : null,
    projects,
    agents,
    tasks: tasks.slice(0, 200).map((t) => ({
      id: t.id,
      title: safeWorldText(t.title),
      roleId: t.roleId,
      status: t.status,
      visualStatus:
        interaction?.nodes.find((n) => n.id === t.id)?.state ?? t.status,
      attempt: t.attemptCount,
      dependsOn: listTaskDependencies(db, t.id).map((d) => d.dependsOnTaskId),
    })),
    approvals,
    budget: {
      capUsd: budget.capUsd,
      spendUsd: budget.liveSpendUsd,
      remainingUsd: budget.remainingUsd,
      reservedUsd: budget.reservedUsd,
      warnAtPercent: budget.warnAtPercent,
      status: budget.status,
    },
    incidents,
    models,
    routing,
    transitions,
    events,
    deliveries: deliveries.slice(0, 30),
    deliveryCount: deliveries.length,
  };
  return {
    ...state,
    revision: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    observedAt: now,
  };
}
export type HeadquartersState = ReturnType<typeof getAIHeadquartersWorldState>;
export type HeadquartersAgent = HeadquartersState["agents"][number];
