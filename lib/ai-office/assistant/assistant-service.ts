import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { parseIntent } from "./intent-parser.ts";
import {
  getAssistantAwareness,
  findProjectByName,
  getBlockedProjects,
  getReadyForReviewProjects,
  getReasonProjectIsBlocked,
  getAllProjects,
  getPendingApprovals,
  getSpendSummary,
  getOvernightBrief,
} from "./assistant-data.ts";
import { listAgentRoles } from "../domain/agent-roles.ts";
import { pauseProject, resumeProject } from "../control/project-transitions.ts";
import { openOffice, closeOffice } from "../control/office-control.ts";
import { decideApproval, getApproval } from "../domain/project-outputs.ts";

export interface PendingAction {
  kind: "PAUSE_PROJECT" | "RESUME_PROJECT" | "OPEN_OFFICE" | "CLOSE_OFFICE" | "APPROVE" | "REJECT";
  label: string;
  projectId?: string;
  approvalId?: string;
}

export interface AssistantTurn {
  message: string;
  pendingAction?: PendingAction;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Teja — the owner's Chief of Staff assistant (Section P-Z). Every fact
 * it states comes straight from `assistant-data.ts`'s read-only
 * projections of already-real state; every action it takes calls the
 * exact same service function the ordinary UI buttons call
 * (`pauseProject`/`resumeProject`/`openOffice`/`closeOffice`/
 * `decideApproval`) — never a parallel status-transition path. Mutating
 * commands always return a `pendingAction` first and wait for an
 * explicit confirm (Section S) rather than acting immediately.
 */
export function handleAssistantText(db: DatabaseSync, text: string): AssistantTurn {
  const intent = parseIntent(text);

  switch (intent.kind) {
    case "CONFIRM":
    case "CANCEL":
      return { message: "There's nothing pending to confirm right now." };

    case "STATUS": {
      const awareness = getAssistantAwareness(db);
      const projects = getAllProjects(db).filter((p) => p.status === "IN_PROGRESS" || p.status === "PLANNING");
      const lines = [
        `Office is ${awareness.officeOpen ? "open" : "closed"}. ${awareness.activeProjects} project(s) active, ${awareness.pendingApprovals} approval(s) pending.`,
        `Office spend this month: ${formatUsd(awareness.monthlyLiveSpendUsd)}.`,
      ];
      if (projects.length > 0) {
        lines.push(...projects.map((p) => `${p.title}: ${p.displayStatusLabel}${p.currentTaskTitle ? ` — ${p.currentTaskTitle}` : ""}`));
      }
      return { message: lines.join("\n") };
    }

    case "NEEDS_ATTENTION": {
      const blocked = getBlockedProjects(db);
      const approvals = getPendingApprovals(db);
      if (blocked.length === 0 && approvals.length === 0) return { message: "Nothing needs your attention right now." };
      const lines: string[] = [];
      if (blocked.length > 0) lines.push(`${blocked.length} project(s) blocked: ${blocked.map((p) => p.title).join(", ")}.`);
      if (approvals.length > 0) lines.push(`${approvals.length} approval(s) pending: ${approvals.map((a) => a.kind).join(", ")}.`);
      return { message: lines.join("\n") };
    }

    case "BLOCKED_WHY": {
      const project = intent.projectNameHint ? findProjectByName(db, intent.projectNameHint) : getBlockedProjects(db)[0];
      if (!project) return { message: intent.projectNameHint ? `I couldn't find a project matching "${intent.projectNameHint}."` : "No project is currently blocked." };
      const reasons = getReasonProjectIsBlocked(db, project.id);
      if (reasons.length === 0) return { message: `${project.title} is ${project.displayStatusLabel.toLowerCase()}, with no unresolved failure recorded.` };
      return { message: `${project.title} is blocked: ${reasons[0]}` };
    }

    case "AGENT_NEEDS": {
      const role = listAgentRoles(db).find((r) => r.name.toLowerCase() === intent.roleNameHint || r.id.replace(/-/g, " ") === intent.roleNameHint);
      if (!role) return { message: `I don't recognize a role called "${intent.roleNameHint}."` };
      const project = getAllProjects(db).find((p) => p.currentTaskRoleId === role.id);
      if (!project) return { message: `${role.name} isn't currently assigned to a task in any active project.` };
      return { message: `${role.name} is working on "${project.currentTaskTitle}" in ${project.title}.` };
    }

    case "SPEND": {
      const budget = getSpendSummary(db);
      return { message: `Office spend this month: ${formatUsd(budget.liveSpendUsd)} of ${formatUsd(budget.capUsd)} (${formatUsd(budget.remainingUsd)} remaining).` };
    }

    case "APPROVALS_NEEDED": {
      const approvals = getPendingApprovals(db);
      if (approvals.length === 0) return { message: "No approvals are pending." };
      return { message: approvals.map((a) => `${a.projectTitle ?? "Office-wide"}: ${a.kind}${a.reason ? ` — ${a.reason}` : ""}`).join("\n") };
    }

    case "QA_RESULT": {
      const project = intent.projectNameHint ? findProjectByName(db, intent.projectNameHint) : undefined;
      if (!project) return { message: "Tell me which project — I couldn't match one from that." };
      const reasons = getReasonProjectIsBlocked(db, project.id);
      if (reasons.length === 0) return { message: `No unresolved QA finding recorded for ${project.title}.` };
      return { message: `${project.title}: ${reasons[0]}` };
    }

    case "READY_FOR_REVIEW": {
      const ready = getReadyForReviewProjects(db);
      if (ready.length === 0) return { message: "No projects are ready for review right now." };
      return { message: `Ready for review: ${ready.map((p) => p.title).join(", ")}.` };
    }

    case "NEXT_ACTION": {
      const approvals = getPendingApprovals(db);
      if (approvals.length > 0) return { message: `Your next action: decide on ${approvals[0].kind} for ${approvals[0].projectTitle ?? "the office"}.` };
      const blocked = getBlockedProjects(db);
      if (blocked.length > 0) return { message: `Your next action: review why ${blocked[0].title} is blocked.` };
      return { message: "Nothing needs your action right now." };
    }

    case "OVERNIGHT_BRIEF": {
      const since = Date.now() - 12 * 60 * 60 * 1000;
      const brief = getOvernightBrief(db, since);
      const lines = [
        `Since ${new Date(since).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}:`,
        `${brief.completedProjects} project(s) reached ready-for-review.`,
        `${brief.blockedProjects.length} project(s) currently blocked${brief.blockedProjects.length > 0 ? `: ${brief.blockedProjects.map((p) => p.title).join(", ")}` : ""}.`,
        `${brief.newApprovals.length} new approval(s) requested.`,
        `${brief.escalations.length} escalation(s) raised.`,
        `Office spend to date: ${formatUsd(brief.spendSinceUsd)}.`,
      ];
      return { message: lines.join("\n") };
    }

    case "PAUSE_PROJECT": {
      const project = intent.projectNameHint ? findProjectByName(db, intent.projectNameHint) : getAllProjects(db).find((p) => p.canPause);
      if (!project) return { message: intent.projectNameHint ? `I couldn't find a project matching "${intent.projectNameHint}."` : "No project is currently pausable." };
      if (!project.canPause) return { message: `${project.title} can't be paused from its current status.` };
      return {
        message: `Pausing "${project.title}" will stop new work from starting but preserve everything done so far. Confirm?`,
        pendingAction: { kind: "PAUSE_PROJECT", label: `Pause "${project.title}"`, projectId: project.id },
      };
    }

    case "RESUME_PROJECT": {
      const project = intent.projectNameHint ? findProjectByName(db, intent.projectNameHint) : getAllProjects(db).find((p) => p.canResume);
      if (!project) return { message: intent.projectNameHint ? `I couldn't find a project matching "${intent.projectNameHint}."` : "No project is currently paused." };
      if (!project.canResume) return { message: `${project.title} can't be resumed from its current status.` };
      return {
        message: `Resuming "${project.title}" will let it pick up eligible work again. Confirm?`,
        pendingAction: { kind: "RESUME_PROJECT", label: `Resume "${project.title}"`, projectId: project.id },
      };
    }

    case "OPEN_OFFICE":
      return { message: "Opening the Office will allow new agent/model execution to start again. Confirm?", pendingAction: { kind: "OPEN_OFFICE", label: "Open the Office" } };

    case "CLOSE_OFFICE":
      return {
        message: "Closing the Office will prevent new model calls but preserve all state. Confirm?",
        pendingAction: { kind: "CLOSE_OFFICE", label: "Close the Office" },
      };

    case "APPROVE": {
      const approvals = getPendingApprovals(db);
      if (approvals.length === 0) return { message: "There's nothing pending to approve." };
      if (approvals.length > 1) return { message: `There are ${approvals.length} pending approvals — please open Approvals to choose one.` };
      return {
        message: `Approve ${approvals[0].kind} for ${approvals[0].projectTitle ?? "the office"}? Confirm?`,
        pendingAction: { kind: "APPROVE", label: `Approve ${approvals[0].kind}`, approvalId: approvals[0].id },
      };
    }

    case "REJECT": {
      const approvals = getPendingApprovals(db);
      if (approvals.length === 0) return { message: "There's nothing pending to reject." };
      if (approvals.length > 1) return { message: `There are ${approvals.length} pending approvals — please open Approvals to choose one.` };
      return {
        message: `Reject ${approvals[0].kind} for ${approvals[0].projectTitle ?? "the office"}? Confirm?`,
        pendingAction: { kind: "REJECT", label: `Reject ${approvals[0].kind}`, approvalId: approvals[0].id },
      };
    }

    case "UNKNOWN":
    default:
      return {
        message:
          "I can answer things like office status, what needs your attention, spend, approvals, or ready-for-review — or act on pause/resume/open/close/approve/reject.",
      };
  }
}

/**
 * Executes a previously-confirmed mutating action — always through the
 * exact existing service function, never a parallel transition (Section
 * S/T). `ownerId` is the real, session-verified owner id; nothing here
 * trusts a client-supplied identity.
 */
export function executeConfirmedAction(db: DatabaseSync, ownerId: string, action: PendingAction): AssistantTurn {
  switch (action.kind) {
    case "PAUSE_PROJECT": {
      if (!action.projectId) return { message: "That action is missing its project." };
      const result = pauseProject(db, action.projectId, ownerId);
      return { message: result.ok ? `Paused. ${action.label.replace("Pause ", "")} is now paused.` : `Couldn't pause: ${result.reason}.` };
    }
    case "RESUME_PROJECT": {
      if (!action.projectId) return { message: "That action is missing its project." };
      const result = resumeProject(db, action.projectId, ownerId);
      return { message: result.ok ? `Resumed. ${action.label.replace("Resume ", "")} is running again.` : `Couldn't resume: ${result.reason}.` };
    }
    case "OPEN_OFFICE":
      openOffice(db, ownerId);
      return { message: "Office is open." };
    case "CLOSE_OFFICE":
      closeOffice(db, ownerId);
      return { message: "Office is closed. All work preserved." };
    case "APPROVE": {
      if (!action.approvalId) return { message: "That action is missing its approval." };
      const approval = getApproval(db, action.approvalId);
      if (!approval || approval.status !== "PENDING") return { message: "That approval was already resolved." };
      decideApproval(db, action.approvalId, "APPROVED", { decidedBy: ownerId, note: "Decided via Teja Assistant." });
      return { message: "Approved." };
    }
    case "REJECT": {
      if (!action.approvalId) return { message: "That action is missing its approval." };
      const approval = getApproval(db, action.approvalId);
      if (!approval || approval.status !== "PENDING") return { message: "That approval was already resolved." };
      decideApproval(db, action.approvalId, "REJECTED", { decidedBy: ownerId, note: "Decided via Teja Assistant." });
      return { message: "Rejected." };
    }
    default:
      return { message: "I don't recognize that action." };
  }
}
