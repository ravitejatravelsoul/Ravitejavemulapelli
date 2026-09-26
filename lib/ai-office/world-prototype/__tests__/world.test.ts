import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canStand,
  movePlayer,
  demoBot,
  BOTS,
  DEMO_DURATION,
} from "../../../../components/ai-office/world-prototype/world-model.ts";
test("player remains within walls and cannot tunnel through desks", () => {
  assert.equal(canStand(0, 15), true);
  assert.equal(canStand(0, 0), false);
  assert.equal(canStand(12, 7), false);
  const [x] = movePlayer(0, 15, 100, 0);
  assert.ok(x < 16.55);
  const [, z] = movePlayer(12, 5, 0, 10);
  assert.ok(z < 6.1);
});
test("all three visual character paths clear furniture and walls", () => {
  for (let t = 0; t <= DEMO_DURATION; t += 0.05)
    for (const id of Object.keys(BOTS) as Array<keyof typeof BOTS>) {
      const { position: p } = demoBot(id, t);
      assert.ok(canStand(p[0], p[2], 0.45), `${id} at ${t}: ${p}`);
    }
});
test("demo travel is continuous, handoffs occur only at rendezvous, reset is idle", () => {
  for (const id of Object.keys(BOTS) as Array<keyof typeof BOTS>) {
    assert.equal(demoBot(id, null).state, "IDLE");
    let last = demoBot(id, 0).position;
    for (let t = 0.05; t < 60; t += 0.05) {
      const p = demoBot(id, t).position;
      assert.ok(Math.hypot(p[0] - last[0], p[2] - last[2]) < 0.4);
      last = p;
    }
  }
  assert.equal(demoBot("product", 16).state, "HANDOFF");
  assert.equal(demoBot("architect", 16).state, "INTERACTING");
  assert.equal(demoBot("architect", 39).state, "HANDOFF");
  assert.equal(demoBot("developer", 39).state, "INTERACTING");
  assert.equal(demoBot("developer", 50).state, "WORKING");
});
