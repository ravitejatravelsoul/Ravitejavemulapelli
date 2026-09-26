import type { Vec3 } from "../../../components/ai-office/world-prototype/world-campus.ts";
import { roomSolids } from "../../../components/ai-office/world-prototype/world-campus.ts";
import {
  HEADQUARTERS_CAMPUS,
  ROLE_STATIONS,
  type HandoffPlayback,
} from "./presentation.ts";

export const PERSONAL_SPACE = 1.15,
  BRIEF_WAIT_MS = 1200,
  MAX_BLOCKED_MS = 4000;
export type VisualMotion = {
  position: Vec3;
  home: Vec3;
  route: Vec3[];
  waypoint: number;
  phase: "PREPARE" | "TRAVEL" | "TRANSFER" | "RETURN" | "DOCK" | "DONE";
  phaseMs: number;
  lastAt: number;
  progress: number;
  blockedMs: number;
  waitMs: number;
  held: boolean;
  detours: number;
  remote: boolean;
  transferFrom: Vec3;
};
const solids = [
  ...(HEADQUARTERS_CAMPUS.shell["floor-50"] ?? []),
  ...roomSolids(HEADQUARTERS_CAMPUS, "floor-50"),
];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function segmentDistance(a: Vec3, b: Vec3, p: Vec3) {
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    d = dx * dx + dz * dz;
  const t = d
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / d))
    : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[2] + dz * t - p[2]);
}
/** Swept personal space and padded solids: no tunneling or corner cutting. */
export function safeVisualSegment(
  a: Vec3,
  b: Vec3,
  boss: Vec3,
  others: Vec3[] = [],
) {
  if (
    segmentDistance(a, b, boss) < PERSONAL_SPACE ||
    others.some((p) => segmentDistance(a, b, p) < 0.9)
  )
    return false;
  const steps = Math.max(1, Math.ceil(distance(a, b) / 0.08));
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / steps,
      z = a[2] + ((b[2] - a[2]) * i) / steps;
    if (
      x < -19.5 ||
      x > 19.5 ||
      z < -18 ||
      z > 18 ||
      solids.some(
        (s) =>
          Math.abs(x - s.x) < s.w / 2 + 0.4 &&
          Math.abs(z - s.z) < s.d / 2 + 0.4,
      )
    )
      return false;
  }
  return true;
}
/** Small bounded visibility graph around the Boss, using only collision-checked edges. */
export function safeOffsetRoute(
  start: Vec3,
  goal: Vec3,
  boss: Vec3,
  original: Vec3[],
  others: Vec3[] = [],
): Vec3[] | null {
  if (!safeVisualSegment(goal, goal, boss, others)) return null;
  const points: Vec3[] = [start, goal, ...original];
  for (const radius of [1.65, 2.4])
    for (let i = 0; i < 12; i++)
      points.push([
        boss[0] + Math.cos((i * Math.PI) / 6) * radius,
        start[1],
        boss[2] + Math.sin((i * Math.PI) / 6) * radius,
      ]);
  const costs = points.map(() => Infinity),
    previous = points.map(() => -1),
    visited = new Set<number>();
  costs[0] = 0;
  for (let n = 0; n < points.length; n++) {
    let best = -1;
    for (let i = 0; i < points.length; i++)
      if (!visited.has(i) && (best < 0 || costs[i] < costs[best])) best = i;
    if (best < 0 || !Number.isFinite(costs[best])) break;
    if (best === 1) {
      const path: Vec3[] = [];
      for (let i = 1; i >= 0; i = previous[i]) path.unshift(points[i]);
      return path;
    }
    visited.add(best);
    for (let i = 1; i < points.length; i++)
      if (!visited.has(i)) {
        const cost = costs[best] + distance(points[best], points[i]);
        if (
          cost < costs[i] &&
          safeVisualSegment(points[best], points[i], boss, others)
        ) {
          costs[i] = cost;
          previous[i] = best;
        }
      }
  }
  return null;
}
/** Presentation only. A body stays at its last safe position if both walking and return are blocked. */
export function stepVisualMotion(
  play: HandoffPlayback,
  boss: Vec3,
  now: number,
  resting: Record<string, Vec3>,
) {
  const m = (play.motion ??= {
    position: [...(resting[play.event.fromRole] ?? play.path[0])] as Vec3,
    home: [...ROLE_STATIONS[play.event.fromRole].home] as Vec3,
    route: play.path,
    waypoint: 1,
    phase: "PREPARE",
    phaseMs: 0,
    lastAt: now,
    progress: 0,
    blockedMs: 0,
    waitMs: 0,
    held: false,
    detours: 0,
    remote: false,
    transferFrom: [...play.path.at(-1)!] as Vec3,
  });
  const dt = Math.max(0, Math.min(100, now - m.lastAt));
  m.lastAt = now;
  m.phaseMs += dt;
  m.held = false;
  const phase = (value: VisualMotion["phase"], progress: number) => {
    m.phase = value;
    m.phaseMs = 0;
    m.progress = progress;
    m.waitMs = 0;
  };
  if (m.phase === "PREPARE") {
    if (m.phaseMs >= 960) phase("TRAVEL", 0.08);
  } else if (m.phase === "TRANSFER") {
    m.progress = 0.42 + 0.2 * Math.min(1, m.phaseMs / 2400);
    if (m.phaseMs >= 2400) {
      m.route = [m.position, ...play.path.slice(0, -1).reverse()];
      m.waypoint = 1;
      phase("RETURN", 0.62);
    }
  } else if (m.phase === "DOCK") {
    m.progress = 0.96 + 0.04 * Math.min(1, m.phaseMs / 800);
    if (m.phaseMs >= 800) phase("DONE", 1);
  } else if (m.phase === "TRAVEL" || m.phase === "RETURN") {
    const outbound = m.phase === "TRAVEL",
      goal = outbound ? play.path.at(-1)! : m.home;
    const others = Object.entries(ROLE_STATIONS)
      .filter(([id]) => id !== play.event.fromRole)
      .map(([id, s]) => resting[id] ?? s.home);
    const target = m.route[m.waypoint] ?? goal,
      d = distance(m.position, target),
      f = Math.min(1, (2.8 * dt) / 1000 / (d || 1));
    const next: Vec3 = [
      m.position[0] + (target[0] - m.position[0]) * f,
      m.position[1] + (target[1] - m.position[1]) * f,
      m.position[2] + (target[2] - m.position[2]) * f,
    ];
    const deadline = now - play.startedAt > 50000;
    if (!deadline && safeVisualSegment(m.position, next, boss, others)) {
      m.position = next;
      m.waitMs = 0;
      if (d < 0.03 || f === 1) m.waypoint++;
      m.progress = outbound
        ? 0.08 + 0.33 * Math.min(1, m.phaseMs / 12000)
        : 0.62 + 0.33 * Math.min(1, m.phaseMs / 12000);
      if (distance(m.position, goal) < 0.03) {
        if (outbound) {
          m.transferFrom = [...m.position];
          phase("TRANSFER", 0.42);
        } else phase("DOCK", 0.96);
      }
    } else {
      m.held = true;
      m.waitMs += dt;
      m.blockedMs += dt;
      if (
        m.waitMs >= BRIEF_WAIT_MS &&
        m.blockedMs < MAX_BLOCKED_MS &&
        !deadline
      ) {
        const route = safeOffsetRoute(
          m.position,
          goal,
          boss,
          play.path,
          others,
        );
        m.waitMs = 0;
        if (route) {
          m.route = route;
          m.waypoint = 1;
          m.detours++;
        }
      }
      if (m.blockedMs >= MAX_BLOCKED_MS || deadline) {
        // No teleport and no walking through the owner. Complete the visual
        // exchange above head height, then try a safe return; park if necessary.
        if (outbound) {
          m.remote = true;
          m.transferFrom = [...m.position];
          phase("TRANSFER", 0.42);
        } else phase("DOCK", 0.96);
      }
    }
  }
  resting[play.event.fromRole] = [...m.position];
  return m;
}
