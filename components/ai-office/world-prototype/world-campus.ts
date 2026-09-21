/** Presentation-only campus model. No Office domain types, actions or execution state. */
export type Vec3 = [number, number, number];
export type Solid = {
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  glass?: boolean;
};
export type StationKind =
  "planning" | "architecture" | "engineering" | "general";
export type CharacterVariant = "planner" | "analyst" | "builder";
export type WorkstationDefinition = {
  id: string;
  position: Vec3;
  dock: Vec3;
  rotation: number;
  kind: StationKind;
  navigationNode: string;
};
export type RoomDefinition = {
  id: string;
  name: string;
  department: string;
  floorId: string;
  position: Vec3;
  dimensions: Vec3;
  capacity: number;
  workstations: WorkstationDefinition[];
  visualTheme: { accent: string };
  template:
    | "reception"
    | "command"
    | "workshop"
    | "owner"
    | "infrastructure"
    | "delivery"
    | "expansion"
    | "module";
  signage: { position: Vec3; rotation: number; subtitle: string };
  connections: string[];
  futureExpansion: boolean;
  solids: Solid[];
};
export type NavigationNode = { id: string; floorId: string; position: Vec3 };
export type NavigationEdge = {
  from: string;
  to: string;
  kind: "walk" | "future-floor-link";
  enabled: boolean;
};
export type WorldDefinition = {
  floors: { id: string; name: string; elevation: number; playable: boolean }[];
  activeFloor: string;
  streetElevation: number;
  rooms: RoomDefinition[];
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  shell: Record<string, Solid[]>;
};
export type AgentVisualDefinition = {
  id: string;
  name: string;
  callSign: string;
  department: string;
  variant: CharacterVariant;
  color: string;
  activity: string;
  preferredStation?: string;
};
export type PlacedAgent = AgentVisualDefinition & {
  roomId: string;
  floorId: string;
  stationId: string;
  home: Vec3;
  workRotation: number;
};
export function roomPosition(
  world: WorldDefinition,
  room: RoomDefinition,
  local: Vec3,
): Vec3 {
  const floor = world.floors.find((f) => f.id === room.floorId);
  if (!floor) throw Error(`Unknown floor ${room.floorId}`);
  return [
    room.position[0] + local[0],
    floor.elevation + room.position[1] + local[1],
    room.position[2] + local[2],
  ];
}
/** Pure allocation preview; it neither spawns characters nor changes real agent assignments. */
export function placeVisualAgents(
  world: WorldDefinition,
  definitions: AgentVisualDefinition[],
): PlacedAgent[] {
  const used = new Set<string>(),
    ids = new Set<string>();
  return definitions.map((agent) => {
    if (ids.has(agent.id)) throw Error(`Duplicate visual agent ${agent.id}`);
    ids.add(agent.id);
    const candidates = world.rooms
      .filter((r) => r.department === agent.department)
      .flatMap((room) =>
        room.workstations
          .slice(0, room.capacity)
          .map((station) => ({ room, station })),
      );
    const selected = candidates.find(
      ({ station }) =>
        !used.has(station.id) &&
        (!agent.preferredStation || agent.preferredStation === station.id),
    );
    if (!selected)
      throw Error(
        `No available workstation for ${agent.id} in ${agent.department}`,
      );
    const { room, station } = selected;
    used.add(station.id);
    return {
      ...agent,
      roomId: room.id,
      floorId: room.floorId,
      stationId: station.id,
      home: roomPosition(world, room, station.dock),
      workRotation: station.rotation + Math.PI,
    };
  });
}
export function navigationPath(
  world: WorldDefinition,
  from: string,
  to: string,
): Vec3[] {
  const byId = new Map(world.nodes.map((n) => [n.id, n]));
  if (!byId.has(from) || !byId.has(to)) throw Error("Unknown navigation node");
  const previous = new Map<string, string | null>([[from, null]]),
    queue = [from];
  for (let i = 0; i < queue.length && !previous.has(to); i++)
    for (const e of world.edges) {
      if (!e.enabled || e.kind !== "walk") continue;
      const next =
        e.from === queue[i] ? e.to : e.to === queue[i] ? e.from : null;
      if (!next || previous.has(next)) continue;
      const a = byId.get(queue[i])!,
        b = byId.get(next);
      if (!b || a.floorId !== b.floorId) continue;
      previous.set(next, queue[i]);
      queue.push(next);
    }
  if (!previous.has(to)) throw Error(`No walkable route from ${from} to ${to}`);
  const path: string[] = [];
  for (let n: string | null = to; n !== null; n = previous.get(n) ?? null)
    path.unshift(n);
  return path.map((id) => [...byId.get(id)!.position] as Vec3);
}
export function moduleWalls(room: RoomDefinition): Solid[] {
  const w = room.dimensions[0],
    d = room.dimensions[2],
    h = room.dimensions[1];
  return [
    { x: -w / 2, z: 0, w: 0.12, d, height: h, glass: true },
    { x: w / 2, z: 0, w: 0.12, d, height: h, glass: true },
    { x: 0, z: d / 2, w, d: 0.12, height: h, glass: true },
    ...[-1, 1].map((side) => ({
      x: (side * (w + 3)) / 4,
      z: -d / 2,
      w: (w - 3) / 2,
      d: 0.12,
      height: h,
      glass: true,
    })),
  ];
}
export function roomSolids(world: WorldDefinition, floorId: string): Solid[] {
  return world.rooms
    .filter((r) => r.floorId === floorId)
    .flatMap((room) => [
      ...[
        ...room.solids,
        ...(room.template === "module" ? moduleWalls(room) : []),
      ].map((s) => ({
        ...s,
        x: s.x + room.position[0],
        z: s.z + room.position[2],
      })),
      ...room.workstations.map((s) => ({
        x: room.position[0] + s.position[0],
        z: room.position[2] + s.position[2],
        w: 4.8,
        d: 1.3,
        height: 1.1,
      })),
    ]);
}
export function canStandInWorld(
  world: WorldDefinition,
  floorId: string,
  x: number,
  z: number,
  radius = 0.32,
) {
  return ![...(world.shell[floorId] ?? []), ...roomSolids(world, floorId)].some(
    (s) =>
      x > s.x - s.w / 2 - radius &&
      x < s.x + s.w / 2 + radius &&
      z > s.z - s.d / 2 - radius &&
      z < s.z + s.d / 2 + radius,
  );
}
/** Reusable single-row room module. More rooms/floors scale capacity without growing one hall. */
export function createRoomModule(
  id: string,
  department: string,
  floorId: string,
  position: Vec3,
  capacity: number,
): RoomDefinition {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw Error("Room capacity must be a positive integer");
  return {
    id,
    name: department.toUpperCase(),
    department,
    floorId,
    position,
    dimensions: [capacity * 5 + 2, 4, 10],
    capacity,
    workstations: Array.from({ length: capacity }, (_, i) => ({
      id: `${id}/station-${i + 1}`,
      position: [(i - (capacity - 1) / 2) * 5, 0, 2],
      dock: [(i - (capacity - 1) / 2) * 5, 1.4, 0],
      rotation: Math.PI,
      kind: "general",
      navigationNode: `${id}/dock-${i + 1}`,
    })),
    visualTheme: { accent: "#9bbac3" },
    template: "module",
    signage: {
      position: [0, 3.3, 4.8],
      rotation: Math.PI,
      subtitle: "TEAM STUDIO",
    },
    connections: [`${id}/entry`],
    futureExpansion: true,
    solids: [],
  };
}
export function moduleNavigation(
  world: WorldDefinition,
  room: RoomDefinition,
): { nodes: NavigationNode[]; edges: NavigationEdge[] } {
  const entry = room.id + "/entry",
    inside = room.id + "/threshold";
  const nodes: NavigationNode[] = [
    {
      id: entry,
      floorId: room.floorId,
      position: roomPosition(world, room, [
        0,
        1.4,
        -room.dimensions[2] / 2 - 1,
      ]),
    },
    {
      id: inside,
      floorId: room.floorId,
      position: roomPosition(world, room, [0, 1.4, -3]),
    },
  ];
  const edges: NavigationEdge[] = [
    { from: entry, to: inside, kind: "walk", enabled: true },
  ];
  for (const station of room.workstations) {
    const aisle = station.navigationNode + "/aisle";
    nodes.push(
      {
        id: aisle,
        floorId: room.floorId,
        position: roomPosition(world, room, [station.dock[0], 1.4, -3]),
      },
      {
        id: station.navigationNode,
        floorId: room.floorId,
        position: roomPosition(world, room, station.dock),
      },
    );
    edges.push(
      { from: inside, to: aisle, kind: "walk", enabled: true },
      { from: aisle, to: station.navigationNode, kind: "walk", enabled: true },
    );
  }
  return { nodes, edges };
}
const room = (
  id: string,
  name: string,
  department: string,
  position: Vec3,
  dimensions: Vec3,
  template: RoomDefinition["template"],
  subtitle: string,
): RoomDefinition => ({
  id,
  name,
  department,
  position,
  dimensions,
  template,
  floorId: "floor-50",
  capacity: 0,
  workstations: [],
  visualTheme: { accent: "#a8c7c7" },
  signage: {
    position: [0, 3.75, -dimensions[2] / 2 + 0.24],
    rotation: 0,
    subtitle,
  },
  connections: [],
  futureExpansion: false,
  solids: [],
});
const reception = room(
    "reception",
    "Reception",
    "welcome",
    [0, 0, 14],
    [34, 8.5, 8],
    "reception",
    "PEOPLE + AI",
  ),
  command = room(
    "command",
    "Command Atrium",
    "command",
    [0, 0, 0],
    [14, 8.5, 22],
    "command",
    "SHARED INTELLIGENCE",
  );
const product = room(
    "product-studio",
    "Product & Research",
    "product",
    [-12, 0, 5],
    [10, 4.6, 10],
    "workshop",
    "IDEAS WITH INTENTION",
  ),
  architecture = room(
    "architecture-studio",
    "Architecture",
    "architecture",
    [-12, 0, -5.5],
    [10, 4.6, 11],
    "workshop",
    "SYSTEMS OF POSSIBILITY",
  ),
  engineering = room(
    "engineering-studio",
    "Engineering",
    "engineering",
    [12, 0, 5],
    [10, 4.6, 10],
    "workshop",
    "CRAFT THE NEXT",
  );
product.workstations = [
  {
    id: "product-01",
    position: [0, 0, 2],
    dock: [0, 1.25, 0],
    rotation: Math.PI,
    kind: "planning",
    navigationNode: "product-dock",
  },
];
architecture.workstations = [
  {
    id: "architecture-01",
    position: [0, 0, -2.5],
    dock: [0, 1.4, -0.5],
    rotation: 0,
    kind: "architecture",
    navigationNode: "architecture-dock",
  },
];
engineering.workstations = [
  {
    id: "engineering-01",
    position: [0, 0, 2],
    dock: [0, 1.2, 0],
    rotation: Math.PI,
    kind: "engineering",
    navigationNode: "developer-dock",
  },
];
for (const r of [product, architecture, engineering]) {
  r.capacity = 1;
  r.connections = [r.workstations[0].navigationNode];
}
product.signage = {
  position: [0, 3.75, 4.7],
  rotation: Math.PI,
  subtitle: product.signage.subtitle,
};
engineering.signage = {
  ...product.signage,
  subtitle: engineering.signage.subtitle,
};
product.visualTheme.accent = "#ffbb70";
architecture.visualTheme.accent = "#8abce9";
engineering.visualTheme.accent = "#65d6c2";
const owner = room(
    "owner",
    "Owner Command",
    "executive",
    [0, 0, -14.5],
    [14, 8.5, 7],
    "owner",
    "HUMAN VISION. AMPLIFIED.",
  ),
  infrastructure = room(
    "infrastructure",
    "Infrastructure",
    "infrastructure",
    [12, 0, -5.5],
    [10, 4.6, 11],
    "infrastructure",
    "OFFICE ENGINEER / FUTURE HOME",
  ),
  delivery = room(
    "delivery",
    "Delivery Vault",
    "delivery",
    [12, 0, -14.5],
    [10, 4.6, 7],
    "delivery",
    "A GALLERY OF POSSIBILITY",
  ),
  expansion = room(
    "expansion",
    "Future Operations",
    "expansion",
    [-12, 0, -14.5],
    [10, 4.6, 7],
    "expansion",
    "DESIGN / QUALITY / SECURITY / RELEASE",
  );
expansion.futureExpansion = true;
expansion.connections = ["expansion-entry"];
owner.connections = ["owner-entry"];
reception.connections = ["reception-entry"];
command.connections = ["west-south", "west-north"];
reception.solids = [
  { x: 12, z: 1.7, w: 2.8, d: 1.2, height: 1.2 },
  { x: 15.5, z: -0.4, w: 1.2, d: 2.8, height: 1.2 },
  { x: -12, z: 1, w: 5, d: 1.5, height: 1.2 },
  ...[-15.6, 15.6].map((x) => ({ x, z: -4, w: 1.1, d: 1.1, height: 0.7 })),
];
command.solids = [{ x: 0, z: 0, w: 4.6, d: 4.6, height: 1.1 }];
owner.solids = [
  { x: 0, z: -0.5, w: 5, d: 1.5, height: 1.1 },
  { x: 4.5, z: -1.3, w: 1.2, d: 2.8, height: 1.2 },
  { x: -5.8, z: -2.3, w: 0.9, d: 0.9, height: 2 },
];
infrastructure.solids = [-2, 1, 3.7].map((x) => ({
  x,
  z: -2,
  w: 1.6,
  d: 2.4,
  height: 2.9,
}));
delivery.solids = [-2, 1, 3.7].map((x) => ({
  x,
  z: -0.5,
  w: 1.5,
  d: 1.5,
  height: 1.1,
}));
expansion.solids = [-2, 2].map((x) => ({
  x,
  z: -0.5,
  w: 2,
  d: 2,
  height: 0.55,
}));
export const OFFICE_WORLD: WorldDefinition = {
  activeFloor: "floor-50",
  streetElevation: -200,
  floors: [
    {
      id: "floor-50",
      name: "50 / Executive & Command",
      elevation: 0,
      playable: true,
    },
    {
      id: "floor-49",
      name: "49 / Product, Architecture & Design",
      elevation: -4,
      playable: false,
    },
    {
      id: "floor-48",
      name: "48 / Engineering & Quality",
      elevation: -8,
      playable: false,
    },
    {
      id: "floor-47",
      name: "47 / Security, Release & Infrastructure",
      elevation: -12,
      playable: false,
    },
  ],
  rooms: [
    reception,
    command,
    product,
    architecture,
    engineering,
    owner,
    infrastructure,
    delivery,
    expansion,
  ],
  nodes: [],
  edges: [],
  shell: {},
};
const points: Record<string, Vec3> = {
  "product-dock": [-12, 1.25, 5],
  "product-aisle": [-10, 1.4, 5],
  "west-south": [-5, 1.4, 5],
  "west-north": [-5, 1.4, -3],
  "po-transfer": [-10.5, 1.4, -3],
  "arc-transfer": [-12, 1.4, -3],
  "architecture-dock": [-12, 1.4, -6],
  "arc-outgoing": [5.4, 1.4, 5],
  "dev-transfer": [7.2, 1.2, 5],
  "developer-dock": [12, 1.2, 5],
  "reception-entry": [0, 1.4, 15],
  "reception-west": [-5, 1.4, 14],
  "owner-entry": [0, 1.4, -12.5],
  "north-aisle": [-5, 1.4, -9],
  "north-center": [0, 1.4, -9],
  "expansion-entry": [-12, 1.4, -12.5],
  "expansion-aisle": [-12, 1.4, -10],
  "west-lab-aisle": [-15.2, 1.4, -3],
  "west-lab-rear": [-15.2, 1.4, -10],
};
OFFICE_WORLD.nodes = Object.entries(points).map(([id, position]) => ({
  id,
  position,
  floorId: "floor-50",
}));
OFFICE_WORLD.edges = [
  ["product-dock", "product-aisle"],
  ["product-aisle", "west-south"],
  ["west-south", "west-north"],
  ["west-north", "po-transfer"],
  ["po-transfer", "arc-transfer"],
  ["arc-transfer", "architecture-dock"],
  ["west-south", "arc-outgoing"],
  ["arc-outgoing", "dev-transfer"],
  ["dev-transfer", "developer-dock"],
  ["reception-entry", "reception-west"],
  ["reception-west", "west-south"],
  ["west-north", "north-aisle"],
  ["north-aisle", "north-center"],
  ["north-center", "owner-entry"],
  ["arc-transfer", "west-lab-aisle"],
  ["west-lab-aisle", "west-lab-rear"],
  ["west-lab-rear", "expansion-aisle"],
  ["expansion-aisle", "expansion-entry"],
].map(([from, to]) => ({ from, to, kind: "walk", enabled: true }));
for (const [id, department, floorId, x, count] of [
  ["design-lab", "design", "floor-49", 0, 8],
  ["engineering-lab", "engineering", "floor-48", 0, 12],
  ["quality-lab", "quality", "floor-48", 72, 8],
  ["security-lab", "security", "floor-47", 0, 8],
  ["release-lab", "release", "floor-47", 52, 8],
] as const) {
  const r = createRoomModule(id, department, floorId, [x, 0, 0], count);
  OFFICE_WORLD.rooms.push(r);
  const n = moduleNavigation(OFFICE_WORLD, r);
  OFFICE_WORLD.nodes.push(...n.nodes);
  OFFICE_WORLD.edges.push(...n.edges);
}
// Reserved inter-floor connections are explicit and deliberately non-walkable today.
for (const target of [
  "design-lab/entry",
  "engineering-lab/entry",
  "security-lab/entry",
])
  OFFICE_WORLD.edges.push({
    from: "expansion-entry",
    to: target,
    kind: "future-floor-link",
    enabled: false,
  });
export const PROTOTYPE_AGENTS: AgentVisualDefinition[] = [
  {
    id: "product",
    name: "Product Owner",
    callSign: "PIP / 01",
    department: "product",
    variant: "planner",
    color: "#ffbb70",
    activity: "Organizing a prototype brief",
    preferredStation: "product-01",
  },
  {
    id: "architect",
    name: "Solution Architect",
    callSign: "ARC / 02",
    department: "architecture",
    variant: "analyst",
    color: "#8abce9",
    activity: "Composing a demo system blueprint",
    preferredStation: "architecture-01",
  },
  {
    id: "developer",
    name: "Developer",
    callSign: "DEX / 03",
    department: "engineering",
    variant: "builder",
    color: "#65d6c2",
    activity: "Building a visual-only interface",
    preferredStation: "engineering-01",
  },
];
export const VISUAL_AGENTS = placeVisualAgents(OFFICE_WORLD, PROTOTYPE_AGENTS);

OFFICE_WORLD.shell["floor-50"] = [
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
