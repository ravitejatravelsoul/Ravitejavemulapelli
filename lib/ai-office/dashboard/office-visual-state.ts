/** Pure, read-only visualization contract. No timers, network, or execution imports.
 * Transition identity (taskId + attempt + status) is available for future renderers. */
export type OfficeAgentVisualStatus = "IDLE" | "QUEUED" | "THINKING" | "WORKING" | "TESTING" | "REVIEWING" | "WAITING" | "BLOCKED" | "FAILED" | "RETRYING" | "DONE" | "PAUSED";
export const VISUAL_LABEL: Record<OfficeAgentVisualStatus, string> = {
  IDLE: "Idle", QUEUED: "Queued", THINKING: "Thinking", WORKING: "Working", TESTING: "Testing",
  REVIEWING: "Reviewing", WAITING: "Waiting", BLOCKED: "Blocked", FAILED: "Failed", RETRYING: "Retrying", DONE: "Done", PAUSED: "Paused",
};
export const DONE_WINDOW_MS = 15_000;
export function isActiveVisualState(status: string): boolean {
  return ["WORKING", "THINKING", "TESTING", "REVIEWING", "RETRYING"].includes(status);
}
export interface VisualStateInput {
  roleId: string;
  projectStatus?: string;
  task?: { status: string; attemptCount: number; updatedAt: number; leaseExpiresAt?: number | null };
  dependenciesSatisfied?: boolean;
  pendingApproval?: boolean;
  runningTaskCount?: number;
  blockedTaskCount?: number;
  now: number;
}
export function mapAgentVisualState(input: VisualStateInput): OfficeAgentVisualStatus {
  const { roleId, task, projectStatus, now } = input;
  if (roleId === "orchestrator") {
    if (projectStatus === "PAUSED") return "PAUSED";
    if (input.pendingApproval) return "WAITING";
    if (projectStatus === "BLOCKED" || input.blockedTaskCount) return "BLOCKED";
    if (projectStatus === "FAILED") return "FAILED";
    if (projectStatus === "PLANNING") return "THINKING";
    return input.runningTaskCount ? "WORKING" : "IDLE";
  }
  if (!task) return "IDLE";
  if (task.status === "DONE") return now >= task.updatedAt && now - task.updatedAt < DONE_WINDOW_MS ? "DONE" : "IDLE";
  if (!["PENDING", "ASSIGNED", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "FAILED"].includes(task.status)) return "IDLE";
  if (task.status === "BLOCKED") return "BLOCKED";
  if (task.status === "FAILED") return "FAILED";
  if (projectStatus === "PAUSED") return "PAUSED";
  if (input.pendingApproval) return "WAITING";
  if (task.status === "IN_PROGRESS") {
    if (task.leaseExpiresAt && task.leaseExpiresAt <= now) return "WAITING";
    if (task.attemptCount > 1) return "RETRYING";
    if (roleId === "qa-agent") return "TESTING";
    if (["security-reviewer", "code-reviewer"].includes(roleId)) return "REVIEWING";
    if (["product-owner", "research-agent"].includes(roleId)) return "THINKING";
    return "WORKING";
  }
  if (task.status === "IN_REVIEW") return "REVIEWING";
  if (task.status === "ASSIGNED") return "QUEUED";
  return input.dependenciesSatisfied ? "QUEUED" : "WAITING";
}
export function summarizeVisualAgents(agents: Array<{ roleId: string; status: string; provider: string | null }>) {
  const workers = agents.filter(a => a.roleId !== "orchestrator");
  const active = workers.filter(a => isActiveVisualState(a.status));
  const providers: Record<string, number> = {};
  for (const agent of active) if (agent.provider) providers[agent.provider] = (providers[agent.provider] ?? 0) + 1;
  return { active: active.length, waiting: workers.filter(a => ["WAITING", "QUEUED", "PAUSED"].includes(a.status)).length,
    reviewing: workers.filter(a => a.status === "REVIEWING").length,
    blocked: workers.filter(a => ["BLOCKED", "FAILED"].includes(a.status)).length, providers };
}
