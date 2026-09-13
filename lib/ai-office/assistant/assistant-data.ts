import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getOfficeOverview, getProjectSummaries, getPendingApprovalsView, getBudgetView, getRunnerActivityView, type ProjectSummary, type PendingApprovalView } from "../dashboard/dashboard-data.ts";
import { getOfficeAnalytics, type OfficeAnalytics } from "../dashboard/analytics-data.ts";
import { listUnresolvedFailures } from "../domain/project-outputs.ts";
import { listProjects } from "../domain/projects.ts";
import { listRecentEscalations, type EscalationRow } from "../domain/escalations.ts";

/**
 * Everything Teja Assistant is allowed to read — every function here is a
 * thin pass-through to a projection the rest of the Office UI already
 * uses (Section R: "Do NOT let Teja assistant scrape rendered UI... it
 * may read projects, tasks, agents, events, failures, approvals,
 * workspace status, QA results, cost/tokens, runner status, Office
 * state, escalations"). No raw SQL, no secrets, no password hashes.
 */
export interface AssistantAwareness {
  officeOpen: boolean;
  activeProjects: number;
  pendingApprovals: number;
  monthlyLiveSpendUsd: number;
}

export function getAssistantAwareness(db: DatabaseSync): AssistantAwareness {
  const overview = getOfficeOverview(db);
  return {
    officeOpen: overview.officeState === "OPEN",
    activeProjects: overview.activeProjects,
    pendingApprovals: overview.pendingApprovals,
    monthlyLiveSpendUsd: overview.currentMonthLiveCostUsd,
  };
}

export function findProjectByName(db: DatabaseSync, nameFragment: string): ProjectSummary | undefined {
  const needle = nameFragment.trim().toLowerCase();
  if (!needle) return undefined;
  return getProjectSummaries(db).find((p) => p.title.toLowerCase().includes(needle));
}

export function getBlockedProjects(db: DatabaseSync): ProjectSummary[] {
  return getProjectSummaries(db).filter((p) => p.status === "BLOCKED" || p.unresolvedFailures > 0);
}

export function getReadyForReviewProjects(db: DatabaseSync): ProjectSummary[] {
  return getProjectSummaries(db).filter((p) => p.status === "READY_FOR_REVIEW");
}

export function getReasonProjectIsBlocked(db: DatabaseSync, projectId: string): string[] {
  return listUnresolvedFailures(db, projectId).map((f) => f.reason);
}

export function getAllProjects(db: DatabaseSync): ProjectSummary[] {
  return getProjectSummaries(db);
}

export function getPendingApprovals(db: DatabaseSync): PendingApprovalView[] {
  return getPendingApprovalsView(db);
}

export function getSpendSummary(db: DatabaseSync) {
  return getBudgetView(db);
}

export function getAnalyticsSummary(db: DatabaseSync): OfficeAnalytics {
  return getOfficeAnalytics(db);
}

export function getRunnerStatus(db: DatabaseSync) {
  return getRunnerActivityView(db);
}

export interface OvernightBrief {
  sinceMs: number;
  completedProjects: number;
  blockedProjects: ProjectSummary[];
  newApprovals: PendingApprovalView[];
  escalations: EscalationRow[];
  spendSinceUsd: number;
}

/** Deterministic, no-paid-model-required summary of everything real that happened since `sinceMs` (Section X). */
export function getOvernightBrief(db: DatabaseSync, sinceMs: number): OvernightBrief {
  const projects = listProjects(db);
  const completedProjects = projects.filter((p) => p.status === "READY_FOR_REVIEW" && p.updatedAt >= sinceMs).length;
  const blockedProjects = getBlockedProjects(db);
  const newApprovals = getPendingApprovalsView(db).filter((a) => a.createdAt >= sinceMs);
  const escalations = listRecentEscalations(db, 50).filter((e) => e.createdAt >= sinceMs);
  const analytics = getOfficeAnalytics(db);

  return {
    sinceMs,
    completedProjects,
    blockedProjects,
    newApprovals,
    escalations,
    spendSinceUsd: analytics.claudeCostUsd, // office-wide total; a since-timestamp delta would need a new ai_usage query — reported as the current running total instead of guessed.
  };
}
