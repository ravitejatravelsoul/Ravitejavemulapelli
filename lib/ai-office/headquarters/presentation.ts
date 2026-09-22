import type { HeadquartersState, HeadquartersAgent } from "./world-state.ts";
import {
  OFFICE_WORLD,
  navigationPath,
  type Vec3,
  type PlacedAgent,
  type CharacterVariant,
} from "../../../components/ai-office/world-prototype/world-campus.ts";
import { along } from "../../../components/ai-office/world-prototype/world-model.ts";
import type { OfficeTransition } from "../dashboard/office-transitions.ts";
export const ROLE_STATIONS: Record<
  string,
  {
    room: string;
    home: Vec3;
    anchor: string;
    color: string;
    variant: CharacterVariant;
    motif: string;
  }
> = {
  orchestrator: {
    room: "command",
    home: [0, 1.5, 3.7],
    anchor: "west-south",
    color: "#b2f1df",
    variant: "analyst",
    motif: "command",
  },
  "product-owner": {
    room: "product",
    home: [-12, 1.25, 5],
    anchor: "product-dock",
    color: "#ffbb70",
    variant: "planner",
    motif: "plan",
  },
  "research-agent": {
    room: "product",
    home: [-15.5, 1.25, 5],
    anchor: "product-dock",
    color: "#f0d78d",
    variant: "analyst",
    motif: "scan",
  },
  "solution-architect": {
    room: "architecture",
    home: [-12, 1.4, -6],
    anchor: "architecture-dock",
    color: "#8abce9",
    variant: "analyst",
    motif: "network",
  },
  "ui-ux-agent": {
    room: "architecture",
    home: [-16.3, 1.3, -6],
    anchor: "west-lab-aisle",
    color: "#e9a7ca",
    variant: "planner",
    motif: "palette",
  },
  "frontend-developer": {
    room: "engineering",
    home: [12, 1.2, 5],
    anchor: "developer-dock",
    color: "#65d6c2",
    variant: "builder",
    motif: "browser",
  },
  "backend-developer": {
    room: "engineering",
    home: [15.5, 1.2, 5],
    anchor: "developer-dock",
    color: "#7fb8f0",
    variant: "builder",
    motif: "database",
  },
  "qa-agent": {
    room: "expansion",
    home: [-12, 1.3, -12.5],
    anchor: "expansion-entry",
    color: "#bfdd8e",
    variant: "builder",
    motif: "test",
  },
  "security-reviewer": {
    room: "expansion",
    home: [-15.5, 1.3, -12.5],
    anchor: "expansion-entry",
    color: "#ecbc82",
    variant: "analyst",
    motif: "shield",
  },
  "code-reviewer": {
    room: "expansion",
    home: [-8.5, 1.3, -12.5],
    anchor: "expansion-entry",
    color: "#bca9e5",
    variant: "analyst",
    motif: "diff",
  },
  "release-agent": {
    room: "delivery",
    home: [12, 1.3, -12.5],
    anchor: "release-aisle",
    color: "#e4ca91",
    variant: "builder",
    motif: "launch",
  },
  "office-engineer": {
    room: "infrastructure",
    home: [12.5, 1.4, -4],
    anchor: "engineer-aisle",
    color: "#9bd0ce",
    variant: "builder",
    motif: "tools",
  },
};
/** Registry extends the approved floor graph; no execution/domain mutation. */
export const HEADQUARTERS_CAMPUS = structuredClone(OFFICE_WORLD);
HEADQUARTERS_CAMPUS.nodes.push(
  { id: "east-north", floorId: "floor-50", position: [5, 1.4, -3] },
  { id: "engineer-aisle", floorId: "floor-50", position: [11.5, 1.4, -3] },
  { id: "release-aisle", floorId: "floor-50", position: [11.5, 1.4, -10] },
);
for (const [from, to] of [
  ["west-north", "east-north"],
  ["east-north", "engineer-aisle"],
  ["engineer-aisle", "release-aisle"],
])
  HEADQUARTERS_CAMPUS.edges.push({ from, to, kind: "walk", enabled: true });
for (const [id, slot] of Object.entries(ROLE_STATIONS)) {
  HEADQUARTERS_CAMPUS.nodes.push({
    id: "hq:" + id,
    floorId: "floor-50",
    position: slot.home,
  });
  // The command core blocks a diagonal approach: use the clear south aisle.
  if (id === "orchestrator") {
    HEADQUARTERS_CAMPUS.nodes.push({
      id: "command-approach",
      floorId: "floor-50",
      position: [0, 1.4, 5],
    });
    HEADQUARTERS_CAMPUS.edges.push(
      {
        from: "west-south",
        to: "command-approach",
        kind: "walk",
        enabled: true,
      },
      { from: "command-approach", to: "hq:" + id, kind: "walk", enabled: true },
    );
  } else
    HEADQUARTERS_CAMPUS.edges.push({
      from: slot.anchor,
      to: "hq:" + id,
      kind: "walk",
      enabled: true,
    });
}
export function visualDefinition(agent: {
  roleId: string;
  name: string;
}): PlacedAgent | null {
  const slot = ROLE_STATIONS[agent.roleId];
  if (!slot) return null;
  return {
    id: agent.roleId,
    name: agent.name,
    callSign: agent.roleId,
    department: slot.room,
    variant: slot.variant,
    color: slot.color,
    activity: "",
    roomId: slot.room,
    floorId: "floor-50",
    stationId: "hq:" + agent.roleId,
    home: slot.home,
    workRotation: slot.room === "architecture" ? Math.PI : 0,
  };
}
export function greeting(hour: number) {
  return hour < 12
    ? "Good morning, Boss."
    : hour < 18
      ? "Good afternoon, Boss."
      : "Good evening, Boss.";
}
export function agentBriefing(
  a: HeadquartersAgent,
  state: HeadquartersState,
  hour = 12,
): string {
  const parts = [greeting(hour)];
  if (!state.project)
    return parts.concat("No project is selected. I am available.").join(" ");
  parts.push(state.project.title + ": " + a.status.toLowerCase() + ".");
  if (a.roleId === "orchestrator")
    parts.push(
      state.project.completed +
        " of " +
        state.project.total +
        " tasks complete; " +
        state.agents.filter((a) =>
          ["WORKING", "THINKING", "TESTING", "REVIEWING", "RETRYING"].includes(
            a.status,
          ),
        ).length +
        " active roles; " +
        state.approvals.filter((p) => p.projectId === state.project?.id)
          .length +
        " pending approvals.",
    );
  else if (a.task) parts.push(a.task + ".");
  else if (a.lastCompletedTask)
    parts.push("Last completed: " + a.lastCompletedTask + ".");
  if (a.provider)
    parts.push(
      "Recorded run: " + a.provider + (a.model ? " / " + a.model : "") + ".",
    );
  if (a.attempt)
    parts.push(
      "Attempt " +
        a.attempt +
        (a.maxAttempts ? " of " + a.maxAttempts : "") +
        ".",
    );
  if (a.blocker) parts.push(a.blocker);
  else if (a.waitingOn.length)
    parts.push("Waiting for " + a.waitingOn.join(", ") + ".");
  if (state.office.state === "CLOSED")
    parts.push("Office is closed; no new work is claimed.");
  return parts.join(" ");
}
export type HandoffPlayback = {
  event: OfficeTransition;
  startedAt: number;
  path: Vec3[];
};
export function handoffPath(event: OfficeTransition): Vec3[] | null {
  if (
    !["HANDOFF", "REMEDIATION"].includes(event.type) ||
    !ROLE_STATIONS[event.fromRole] ||
    !ROLE_STATIONS[event.toRole]
  )
    return null;
  try {
    const path = navigationPath(
      HEADQUARTERS_CAMPUS,
      "hq:" + event.fromRole,
      "hq:" + event.toRole,
    ).map((p) => [...p] as Vec3);
    let remaining = 1.15;
    while (path.length > 1 && remaining > 0) {
      const a = path.at(-2)!,
        b = path.at(-1)!,
        distance = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (distance <= remaining) {
        path.pop();
        remaining -= distance;
      } else {
        path[path.length - 1] = b.map(
          (v, i) => v + ((a[i] - v) * remaining) / distance,
        ) as Vec3;
        remaining = 0;
      }
    }
    return path;
  } catch {
    return null;
  }
}
export function liveSample(
  a: { roleId: string; status: string },
  play: HandoffPlayback | null,
  now: number,
  animate: boolean,
) {
  const home = ROLE_STATIONS[a.roleId]?.home ?? ([0, 1.4, 5] as Vec3);
  let position = home,
    carry = false;
  let state: "IDLE" | "WORKING" | "FLOATING" | "HANDOFF" = "IDLE";
  if (
    animate &&
    ["WORKING", "THINKING", "TESTING", "REVIEWING", "RETRYING"].includes(
      a.status,
    )
  )
    state = "WORKING";
  if (animate && play && play.event.fromRole === a.roleId) {
    const t = (now - play.startedAt) / 12000;
    if (t >= 0 && t < 1) {
      const f = t < 0.42 ? t / 0.42 : t < 0.58 ? 1 : 1 - (t - 0.58) / 0.42;
      position = along(play.path, Math.min(1, Math.max(0, f)));
      state = t >= 0.42 && t < 0.58 ? "HANDOFF" : "FLOATING";
      carry = t < 0.5;
    }
  }
  if (animate && play && play.event.toRole === a.roleId) {
    const t = (now - play.startedAt) / 12000;
    if (t > 0.42 && t < 0.58) state = "HANDOFF";
  }
  return { position, state, carry };
}
/** No history replay on first load, project switch, hidden tab or stale connection. */
export function latestTransition(
  incoming: OfficeTransition[],
  seen: Set<string>,
  now: number,
  enabled: boolean,
) {
  const fresh = incoming.filter(
    (t) => !seen.has(t.id) && t.occurredAt <= now && now - t.occurredAt < 20000,
  );
  incoming.forEach((t) => seen.add(t.id));
  while (seen.size > 256) seen.delete(seen.values().next().value!);
  return enabled
    ? (fresh
        .filter((t) => handoffPath(t))
        .sort((a, b) => b.occurredAt - a.occurredAt)[0] ?? null)
    : null;
}
