/** Visual-only demo/controller. The reusable campus model is independent of this three-character scenario. */
import {
  OFFICE_WORLD,
  VISUAL_AGENTS,
  roomSolids,
  navigationPath,
  canStandInWorld,
  type PlacedAgent,
  type Vec3,
} from "./world-campus.ts";
export type { Vec3, Solid } from "./world-campus.ts";
export type BotId = string;
export type BotState =
  | "IDLE"
  | "WORKING"
  | "UNDOCKING"
  | "FLOATING"
  | "INTERACTING"
  | "HANDOFF"
  | "RETURNING";
export const BOTS: Record<string, PlacedAgent> = Object.fromEntries(
  VISUAL_AGENTS.map((a) => [a.id, a]),
);
export const WALLS = OFFICE_WORLD.shell[OFFICE_WORLD.activeFloor];
export const FURNITURE = roomSolids(OFFICE_WORLD, OFFICE_WORLD.activeFloor);
export const SPAWN: Vec3 = [0, 1.7, 15];
export const DEMO_DURATION = 60;
const smooth = (t: number) => t * t * (3 - 2 * t);
export function along(points: Vec3[], t: number): Vec3 {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[2] - points[i][2]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let distance = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? distance / lengths[i] : 1;
      return points[i].map((v, j) => v + (points[i + 1][j] - v) * f) as Vec3;
    }
    distance -= lengths[i];
  }
  return points[0];
}
const poPath = navigationPath(OFFICE_WORLD, "product-dock", "po-transfer");
const arcMeet = OFFICE_WORLD.nodes.find(
  (n) => n.id === "arc-transfer",
)!.position;
const arcPath = navigationPath(
  OFFICE_WORLD,
  "architecture-dock",
  "arc-outgoing",
);
const devMeet = OFFICE_WORLD.nodes.find(
  (n) => n.id === "dev-transfer",
)!.position;
export function demoBot(
  id: BotId,
  time: number | null,
): { position: Vec3; state: BotState; carry: boolean } {
  const home = BOTS[id].home;
  let position = home,
    state: BotState = "IDLE",
    carry = false;
  const move = (
    path: Vec3[],
    start: number,
    end: number,
    returning = false,
  ) => {
    position = along(
      path,
      smooth(Math.min(1, Math.max(0, ((time ?? 0) - start) / (end - start)))),
    );
    state = returning ? "RETURNING" : "FLOATING";
  };
  if (time === null) return { position, state, carry };
  if (id === "product") {
    if (time < 3) state = "WORKING";
    else if (time < 5) {
      state = "UNDOCKING";
      position = [home[0], home[1] + 0.15 * smooth((time - 3) / 2), home[2]];
    } else if (time < 15) move(poPath, 5, 15);
    else if (time < 18) {
      position = poPath.at(-1)!;
      state = "HANDOFF";
    } else if (time < 30) move([...poPath].reverse(), 18, 30, true);
    carry = time >= 3 && time < 15;
  }
  if (id === "architect") {
    if (time >= 10 && time < 15) move([home, arcMeet], 10, 15);
    else if (time >= 15 && time < 18) {
      position = arcMeet;
      state = "INTERACTING";
    } else if (time >= 18 && time < 23) move([arcMeet, home], 18, 23, true);
    else if (time >= 23 && time < 29) state = "WORKING";
    else if (time >= 29 && time < 38) move(arcPath, 29, 38);
    else if (time >= 38 && time < 41) {
      position = arcPath.at(-1)!;
      state = "HANDOFF";
    } else if (time >= 41 && time < 55)
      move([...arcPath].reverse(), 41, 55, true);
    carry = (time >= 18 && time < 23) || (time >= 29 && time < 38);
  }
  if (id === "developer") {
    if (time >= 33 && time < 38) move([home, devMeet], 33, 38);
    else if (time >= 38 && time < 41) {
      position = devMeet;
      state = "INTERACTING";
    } else if (time >= 41 && time < 47) move([devMeet, home], 41, 47, true);
    else if (time >= 47) state = "WORKING";
    carry = time >= 41 && time < 47;
  }
  return { position, state, carry };
}
export function canStand(x: number, z: number, radius = 0.32) {
  return canStandInWorld(OFFICE_WORLD, OFFICE_WORLD.activeFloor, x, z, radius);
}
export function movePlayer(x: number, z: number, dx: number, dz: number) {
  // Substeps prevent tunnelling during frame stalls; axis separation permits sliding.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
  for (let i = 0; i < steps; i++) {
    if (canStand(x + dx / steps, z)) x += dx / steps;
    if (canStand(x, z + dz / steps)) z += dz / steps;
  }
  return [x, z] as const;
}
export function demoChapter(t: number | null) {
  return t === null
    ? "Explore the headquarters"
    : t < 5
      ? "01 / PIP prepares the brief"
      : t < 15
        ? "02 / Follow PIP to Architecture"
        : t < 18
          ? "03 / Task Core transfer → ARC"
          : t < 29
            ? "04 / ARC composes the system"
            : t < 38
              ? "05 / Follow ARC to Engineering"
              : t < 41
                ? "06 / Task Core transfer → DEX"
                : t < 47
                  ? "07 / DEX returns to the build station"
                  : "08 / DEX builds · demo complete";
}
