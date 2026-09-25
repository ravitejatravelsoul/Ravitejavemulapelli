import type { HeadquartersState, HeadquartersAgent } from "./world-state.ts";
import type { OfficeTransition } from "../dashboard/office-transitions.ts";
import {
  greeting,
  handoffPath,
  ROLE_STATIONS,
  liveSample,
  type HandoffPlayback,
} from "./presentation.ts";
import type { Vec3 } from "../../../components/ai-office/world-prototype/world-campus.ts";
export const VISUAL_PENDING_LIMIT = 3,
  VISUAL_FRESH_MS = 60_000,
  GREETING_COOLDOWN_MS = 90_000;
export const ACTIVE_STATES = new Set([
  "WORKING",
  "THINKING",
  "TESTING",
  "REVIEWING",
  "RETRYING",
]);
export type VisualQueue = {
  seen: string[];
  watermark: number;
  pending: OfficeTransition[];
  current: HandoffPlayback | null;
  initialized: boolean;
};
export const emptyVisualQueue = (): VisualQueue => ({
  seen: [],
  watermark: 0,
  pending: [],
  current: null,
  initialized: false,
});
export function playbackDuration(path: Vec3[]) {
  const length = path
    .slice(1)
    .reduce(
      (n, p, i) => n + Math.hypot(p[0] - path[i][0], p[2] - path[i][2]),
      0,
    );
  return Math.max(12000, Math.min(40000, ((length / 2.8) * 2 + 6) * 1000));
}
export function advanceVisualQueue(
  q: VisualQueue,
  incoming: OfficeTransition[],
  now: number,
  enabled: boolean,
): VisualQueue {
  const known = new Set(q.seen),
    fresh = incoming.filter(
      (e) =>
        !known.has(e.id) &&
        e.occurredAt >= q.watermark &&
        e.occurredAt <= now &&
        now - e.occurredAt < VISUAL_FRESH_MS &&
        handoffPath(e),
    );
  incoming.forEach((e) => known.add(e.id));
  const base = {
    seen: [...known].slice(-512),
    watermark: Math.max(
      q.watermark,
      ...incoming.filter((e) => e.occurredAt <= now).map((e) => e.occurredAt),
    ),
    initialized: true,
  };
  if (!enabled || !q.initialized)
    return { ...base, pending: [], current: null };
  let current = q.current;
  if (
    current &&
    (current.motion
      ? current.motion.phase === "DONE"
      : now - current.startedAt - (current.pausedMs ?? 0) >=
        (current.durationMs ?? 12000))
  )
    current = null;
  const pending = [...q.pending, ...fresh]
    .filter(
      (e) =>
        (e.type === "DELIVERY" || now - e.occurredAt < VISUAL_FRESH_MS) &&
        e.id !== current?.event.id,
    )
    .sort(
      (a, b) =>
        Number(b.type === "DELIVERY") - Number(a.type === "DELIVERY") ||
        b.occurredAt - a.occurredAt ||
        b.id.localeCompare(a.id),
    )
    .slice(0, VISUAL_PENDING_LIMIT);
  if (!current) {
    const event = pending.shift();
    if (event) {
      const path = handoffPath(event)!;
      current = {
        event,
        path,
        startedAt: now,
        durationMs: playbackDuration(path),
        pausedMs: 0,
      };
    }
  }
  return { ...base, current, pending };
}
export function playbackProgress(play: HandoffPlayback, now: number) {
  if (play.motion) return play.motion.progress;
  return Math.max(
    0,
    Math.min(
      1,
      (now - play.startedAt - (play.pausedMs ?? 0)) /
        (play.durationMs ?? 12000),
    ),
  );
}
export function playbackPhase(play: HandoffPlayback, now: number) {
  const t = playbackProgress(play, now);
  return t < 0.08
    ? "PREPARE"
    : t < 0.42
      ? "TRAVEL"
      : t < 0.62
        ? "TRANSFER"
        : t < 0.96
          ? "RETURN"
          : "DOCK";
}
export function presentationStatus(status: string) {
  const colors: Record<string, string> = {
    WORKING: "#6fd5c2",
    THINKING: "#9dc3ed",
    TESTING: "#c6e28e",
    REVIEWING: "#c5abe7",
    WAITING: "#8a9fa8",
    BLOCKED: "#e7ae68",
    FAILED: "#e99080",
    RETRYING: "#efbd78",
    DONE: "#9fe1b9",
    IDLE: "#9cafa9",
    PAUSED: "#a2a9ae",
    QUEUED: "#adc5d5",
  };
  return {
    color: colors[status] ?? colors.IDLE,
    active: ACTIVE_STATES.has(status),
    warning: ["FAILED", "BLOCKED", "RETRYING"].includes(status),
  };
}
export function dagStatus(status: string) {
  return status === "IN_PROGRESS"
    ? "WORKING"
    : status === "PENDING" || status === "ASSIGNED"
      ? "WAITING"
      : status;
}
export function briefSignature(a: HeadquartersAgent, projectId?: string) {
  return JSON.stringify([
    projectId,
    a.taskId,
    a.status,
    a.attempt,
    a.provider,
    a.model,
    a.blocker,
    a.waitingOn,
  ]);
}
export function shouldGreet(
  previous: { at: number; signature: string } | undefined,
  signature: string,
  now: number,
) {
  return (
    !previous ||
    previous.signature !== signature ||
    now - previous.at >= GREETING_COOLDOWN_MS
  );
}
export function proximityBriefing(
  a: HeadquartersAgent,
  s: HeadquartersState,
  hour: number,
) {
  const first = greeting(hour),
    p = s.project;
  if (!p) return first + " No project is selected.";
  if (a.roleId === "orchestrator") {
    const active = s.agents
      .filter((x) => ACTIVE_STATES.has(x.status))
      .map((x) => x.name)
      .slice(0, 3);
    return `${first} ${p.title}: ${p.completed} of ${p.total} tasks complete. ${active.length ? active.join(", ") + " active." : "No active roles recorded."} ${s.approvals.filter((x) => x.projectId === p.id).length} owner approvals. Recorded cost $${p.costUsd.toFixed(2)}.`;
  }
  const task = a.task ?? a.lastCompletedTask;
  const fact = a.task
    ? `${a.status.toLowerCase()}: ${task}`
    : task
      ? `Last completed: ${task}`
      : `${a.status.toLowerCase()} for ${p.title}`;
  const route = a.provider
    ? ` Recorded run: ${a.provider}${a.model ? " / " + a.model : ""}.`
    : "";
  const block = a.blocker
    ? " " + a.blocker
    : a.waitingOn.length
      ? " Waiting for dependencies."
      : " No recorded blocker.";
  return `${first} ${fact}.${route}${a.attempt ? ` Attempt ${a.attempt}.` : ""}${block}`;
}
export function cinematicPose(play: HandoffPlayback, now: number) {
  const a = liveSample(
    { roleId: play.event.fromRole, status: "IDLE" },
    play,
    now,
    true,
  ).position;
  const target =
    play.event.type === "DELIVERY"
      ? ([10, 1.8, -15] as Vec3)
      : ROLE_STATIONS[play.event.toRole].home;
  const t = playbackProgress(play, now),
    focus: Vec3 =
      t >= 0.4 && t < 0.66
        ? [(a[0] + target[0]) / 2, 1.35, (a[2] + target[2]) / 2]
        : [a[0], 1.35, a[2]];
  const focusRole =
    t >= 0.4 && t < 0.66 ? play.event.toRole : play.event.fromRole;
  const cameraZ = ["frontend-developer", "backend-developer"].includes(
    focusRole,
  )
    ? -4.5
    : 4.5;
  // View development transfers from the clear north side, away from their tall screens.
  // The camera never becomes the Boss collision body.
  return {
    position: [focus[0] + 3.2, 4.1, focus[2] + cameraZ] as Vec3,
    target: focus,
  };
}
export type WorldNotice = {
  id: string;
  at: number;
  title: string;
  detail: string;
};
export function meaningfulNotices(s: HeadquartersState): WorldNotice[] {
  const notices: WorldNotice[] = s.transitions
    .filter((e) =>
      [
        "REMEDIATION",
        "APPROVAL_REQUEST",
        "INCIDENT",
        "RECOVERY",
        "DELIVERY",
      ].includes(e.type),
    )
    .map((e) => ({
      id: e.id,
      at: e.occurredAt,
      title: (
        {
          REMEDIATION: "REMEDIATION",
          APPROVAL_REQUEST: "OWNER APPROVAL REQUIRED",
          INCIDENT: "INFRASTRUCTURE INCIDENT",
          RECOVERY: "SYSTEM RESTORED",
          DELIVERY: "DELIVERY VERIFIED",
        } as Record<string, string>
      )[e.type],
      detail:
        e.type === "DELIVERY"
          ? (s.project?.title ?? "Verified delivery")
          : e.label,
    }));
  for (const a of s.agents)
    for (const r of a.runs) {
      if (r.status !== "QUEUED")
        notices.push({
          id: "started:" + r.id,
          at: r.startedAt,
          title: "AGENT STARTED",
          detail:
            a.name + " · " + (a.task ?? a.lastCompletedTask ?? "Recorded task"),
        });
      if (["FAILED", "ESCALATED"].includes(r.status) && r.finishedAt)
        notices.push({
          id: "failed:" + r.id,
          at: r.finishedAt,
          title:
            a.roleId === "qa-agent"
              ? "QA FAILURE"
              : a.roleId === "security-reviewer"
                ? "SECURITY FAILURE"
                : a.roleId === "code-reviewer"
                  ? "CODE REVIEW RETURN"
                  : "TASK FAILURE",
          detail: a.name + " · inspect the recorded task",
        });
    }
  for (const e of s.events)
    if (["project.created", "project.planned"].includes(e.type))
      notices.push({
        id: e.id,
        at: e.at,
        title:
          e.type === "project.planned" ? "PROJECT PLANNED" : "PROJECT RECEIVED",
        detail: s.project?.title ?? "Project",
      });
  return notices.sort((a, b) => b.at - a.at);
}

export function engineerBriefing(s: HeadquartersState, hour: number) {
  return `${greeting(hour)} Recorded infrastructure status: ${s.office.health}. Runner: ${s.office.runner}.${s.mode === "remote" ? " Remote snapshot; this view does not probe or repair workers." : ""}`;
}
