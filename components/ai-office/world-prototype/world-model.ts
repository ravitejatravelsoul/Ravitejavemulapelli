/** Visual-only world constants. No Office domain imports or execution hooks. Metres. */
export type Vec3 = [number, number, number];
export type BotId = "product" | "architect" | "developer";
export type BotState =
  | "IDLE"
  | "WORKING"
  | "UNDOCKING"
  | "FLOATING"
  | "INTERACTING"
  | "HANDOFF"
  | "RETURNING";
export const BOTS = {
  product: {
    name: "Product Owner",
    callSign: "PIP / 01",
    color: "#ffbb70",
    home: [-12, 1.25, 5] as Vec3,
    activity: "Organizing a prototype brief",
  },
  architect: {
    name: "Solution Architect",
    callSign: "ARC / 02",
    color: "#8abce9",
    home: [-12, 1.4, -6] as Vec3,
    activity: "Composing a demo system blueprint",
  },
  developer: {
    name: "Developer",
    callSign: "DEX / 03",
    color: "#65d6c2",
    home: [12, 1.2, 5] as Vec3,
    activity: "Building a visual-only interface",
  },
};
export type Solid = {
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  glass?: boolean;
};
export const WALLS: Solid[] = [
  { x: 0, z: 18, w: 34, d: 0.3, height: 4.6 },
  { x: 0, z: -18, w: 34, d: 0.3, height: 4.6 },
  { x: -17, z: 0, w: 0.3, d: 36, height: 4.6 },
  { x: 17, z: 0, w: 0.3, d: 36, height: 4.6 },
  // Atrium wings have broad doorways at z=5 and z=-3.
  ...[-7, 7].flatMap((x) => [
    { x, z: 10, w: 0.22, d: 6, height: 3.5, glass: true },
    { x, z: 1, w: 0.22, d: 4, height: 3.5, glass: true },
    { x, z: -8, w: 0.22, d: 6, height: 3.5, glass: true },
  ]),
  ...[-12, 12].map((x) => ({
    x,
    z: 0,
    w: 10,
    d: 0.22,
    height: 3.5,
    glass: true,
  })),
  ...[-15, -9, 9, 15].map((x) => ({ x, z: -11, w: 4, d: 0.25, height: 3.8 })),
  { x: -5, z: -11, w: 4, d: 0.22, height: 3.5, glass: true },
  { x: 5, z: -11, w: 4, d: 0.22, height: 3.5, glass: true },
  { x: 7, z: -15, w: 0.22, d: 6, height: 3.5, glass: true },
  { x: -7, z: -15, w: 0.22, d: 6, height: 3.5, glass: true },
];
// Furniture colliders share their positions with the rendered geometry.
export const FURNITURE: Solid[] = [
  { x: 12, z: 15.7, w: 2.8, d: 1.2, height: 1.2 },
  { x: 15.5, z: 13.6, w: 1.2, d: 2.8, height: 1.2 },
  { x: 4.5, z: -15.8, w: 1.2, d: 2.8, height: 1.2 },
  { x: -5.8, z: -16.8, w: 0.9, d: 0.9, height: 2 },
  ...[-15.6, 15.6].map((x) => ({ x, z: 10, w: 1.1, d: 1.1, height: 0.7 })),
  { x: 0, z: 0, w: 4.6, d: 4.6, height: 1.1 },
  ...[-12, 12].map((x) => ({ x, z: 7, w: 4.8, d: 1.3, height: 1.1 })),
  { x: -12, z: -8, w: 4.8, d: 1.3, height: 1.1 },
  { x: 0, z: -15, w: 5, d: 1.5, height: 1.1 },
  ...[10, 13, 15.7].map((x) => ({ x, z: -7.5, w: 1.6, d: 2.4, height: 2.9 })),
  ...[10, 13, 15.7].map((x) => ({ x, z: -15, w: 1.5, d: 1.5, height: 1.1 })),
  { x: -12, z: 15, w: 5, d: 1.5, height: 1.2 },
  ...[-14, -10].map((x) => ({ x, z: -15, w: 2, d: 2, height: 0.55 })),
];
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
const poPath: Vec3[] = [
  BOTS.product.home,
  [-10, 1.4, 5],
  [-5, 1.4, 5],
  [-5, 1.4, -3],
  [-10.5, 1.4, -3],
];
const arcMeet: Vec3 = [-12, 1.4, -3];
const arcPath: Vec3[] = [
  BOTS.architect.home,
  [-12, 1.4, -3],
  [-5, 1.4, -3],
  [-5, 1.4, 5],
  [5.4, 1.4, 5],
];
const devMeet: Vec3 = [7.2, 1.2, 5];
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
  return ![...WALLS, ...FURNITURE].some(
    (s) =>
      x > s.x - s.w / 2 - radius &&
      x < s.x + s.w / 2 + radius &&
      z > s.z - s.d / 2 - radius &&
      z < s.z + s.d / 2 + radius,
  );
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
