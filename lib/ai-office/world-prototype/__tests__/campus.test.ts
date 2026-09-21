import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_WORLD,
  VISUAL_AGENTS,
  PROTOTYPE_AGENTS,
  placeVisualAgents,
  createRoomModule,
  moduleNavigation,
  navigationPath,
  roomPosition,
  canStandInWorld,
  type AgentVisualDefinition,
} from "../../../../components/ai-office/world-prototype/world-campus.ts";
import {
  cityBuildings,
  STREET_Y,
} from "../../../../components/ai-office/world-prototype/world-city-model.ts";
test("20 independent visual definitions occupy unique department slots without adding visible bots", () => {
  const world = structuredClone(OFFICE_WORLD);
  const agents: AgentVisualDefinition[] = Array.from(
    { length: 20 },
    (_, i) => ({
      id: `synthetic-${i}`,
      name: `Specialist ${i}`,
      callSign: `S${i}`,
      department: i < 12 ? "engineering" : "quality",
      variant: "builder",
      color: "#66aabb",
      activity: "synthetic configuration only",
    }),
  );
  const placed = placeVisualAgents(world, [
    ...PROTOTYPE_AGENTS,
    ...agents,
  ]).slice(PROTOTYPE_AGENTS.length);
  assert.equal(placed.length, 20);
  assert.equal(new Set(placed.map((a) => a.stationId)).size, 20);
  for (const a of placed) {
    const room = world.rooms.find((r) => r.id === a.roomId)!;
    assert.equal(room.department, a.department);
    const slot = room.workstations.find((s) => s.id === a.stationId)!;
    assert.deepEqual(a.home, roomPosition(world, room, slot.dock));
    assert.ok(world.nodes.some((n) => n.id === slot.navigationNode));
  }
  assert.equal(VISUAL_AGENTS.length, 3);
  assert.equal(
    OFFICE_WORLD.rooms.filter(
      (r) => r.floorId === "floor-50" && r.template === "workshop",
    ).length,
    3,
  );
  assert.throws(
    () =>
      placeVisualAgents(
        world,
        Array.from({ length: 21 }, (_, i) => ({
          ...agents[0],
          id: `overflow-${i}`,
          department: "quality",
        })),
      ),
    /No available workstation/,
  );
});
test("new room modules extend slots, navigation, collision and floors to 60 visual definitions", () => {
  const world = structuredClone(OFFICE_WORLD);
  const definitions: AgentVisualDefinition[] = [];
  for (let i = 0; i < 10; i++) {
    const room = createRoomModule(
      `extension-${i}`,
      "research",
      "floor-49",
      [i * 40, 0, 40],
      6,
    );
    world.rooms.push(room);
    const nav = moduleNavigation(world, room);
    world.nodes.push(...nav.nodes);
    world.edges.push(...nav.edges);
    if (i)
      world.edges.push({
        from: `extension-${i - 1}/entry`,
        to: `extension-${i}/entry`,
        kind: "walk",
        enabled: true,
      });
    for (let j = 0; j < 6; j++)
      definitions.push({
        id: `research-${i}-${j}`,
        name: "Research visual",
        callSign: "R",
        department: "research",
        variant: "analyst",
        color: "#88aacc",
        activity: "configuration fixture",
      });
    for (const slot of room.workstations) {
      const path = navigationPath(
        world,
        `${room.id}/entry`,
        slot.navigationNode,
      );
      assert.ok(path.length >= 2);
      for (let segment = 1; segment < path.length; segment++)
        for (let step = 0; step <= 20; step++) {
          const t = step / 20,
            a = path[segment - 1],
            b = path[segment],
            x = a[0] + (b[0] - a[0]) * t,
            z = a[2] + (b[2] - a[2]) * t;
          assert.ok(canStandInWorld(world, room.floorId, x, z));
        }
      const desk = roomPosition(world, room, slot.position);
      assert.equal(
        canStandInWorld(world, room.floorId, desk[0], desk[2]),
        false,
      );
    }
  }
  const placed = placeVisualAgents(world, definitions);
  assert.equal(placed.length, 60);
  assert.equal(new Set(placed.map((a) => a.stationId)).size, 60);
  assert.ok(placed.every((a) => a.home[1] < 0));
  assert.ok(
    navigationPath(world, "extension-0/entry", "extension-9/dock-6").length >
      10,
  );
  assert.throws(
    () => navigationPath(world, "expansion-entry", "extension-0/entry"),
    /No walkable route/,
  );
  assert.throws(
    () => navigationPath(world, "expansion-entry", "engineering-lab/entry"),
    /No walkable route/,
  );
});
test("city is anchored 200m below the office, keeps a clear facade buffer and scales exterior detail", () => {
  const high = cityBuildings(true),
    balanced = cityBuildings(false);
  assert.equal(STREET_Y, -200);
  assert.ok(high.facades.length > balanced.facades.length);
  assert.ok(balanced.facades.some((b) => b.position[1] + b.size[1] / 2 > 0));
  assert.ok(balanced.facades.some((b) => b.position[1] + b.size[1] / 2 < -70));
  for (const b of high.facades) {
    assert.ok(b.position[1] - b.size[1] / 2 >= STREET_Y - 0.001);
    assert.ok(
      Math.abs(b.position[0]) - b.size[0] / 2 > 20 ||
        Math.abs(b.position[2]) - b.size[2] / 2 > 21,
    );
  }
  assert.deepEqual(
    cityBuildings(false),
    balanced,
    "stable geometry across visits and camera motion",
  );
});

test("configured current-floor navigation edges clear room furniture and glass", () => {
  for (const e of OFFICE_WORLD.edges) {
    if (!e.enabled || e.kind !== "walk") continue;
    const a = OFFICE_WORLD.nodes.find((n) => n.id === e.from)!,
      b = OFFICE_WORLD.nodes.find((n) => n.id === e.to)!;
    assert.ok(a && b);
    if (a.floorId !== "floor-50") continue;
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      assert.ok(
        canStandInWorld(
          OFFICE_WORLD,
          a.floorId,
          a.position[0] + (b.position[0] - a.position[0]) * t,
          a.position[2] + (b.position[2] - a.position[2]) * t,
        ),
        e.from + " -> " + e.to,
      );
    }
  }
});
