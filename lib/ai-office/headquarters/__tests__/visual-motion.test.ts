import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stepVisualMotion,
  safeOffsetRoute,
  safeVisualSegment,
  PERSONAL_SPACE,
} from "../visual-motion.ts";
import {
  handoffPath,
  liveSample,
  type HandoffPlayback,
} from "../presentation.ts";
import { advanceVisualQueue, emptyVisualQueue } from "../experience.ts";
import type { OfficeTransition } from "../../dashboard/office-transitions.ts";
import type { Vec3 } from "../../../../components/ai-office/world-prototype/world-campus.ts";
const delivery = (at: number): OfficeTransition => ({
  id: "delivery:real",
  projectId: "p",
  taskId: "t",
  attempt: 1,
  fromRole: "release-agent",
  toRole: "delivery",
  type: "DELIVERY",
  occurredAt: at,
  status: "VERIFIED",
  evidenceId: "release-run",
  label: "Verified",
});
function run(
  event: OfficeTransition,
  boss: Vec3,
  resting: Record<string, Vec3> = {},
) {
  const play: HandoffPlayback = {
    event,
    path: handoffPath(event)!,
    startedAt: 0,
  };
  let min = Infinity,
    held = false,
    remote = false,
    transfer = false;
  for (let now = 0; now < 65000; now += 16) {
    const m = stepVisualMotion(play, boss, now, resting);
    min = Math.min(
      min,
      Math.hypot(m.position[0] - boss[0], m.position[2] - boss[2]),
    );
    held ||= m.held;
    remote ||= m.remote;
    transfer ||= m.phase === "TRANSFER";
    if (m.phase === "DONE")
      return { play, min, held, remote, transfer, now, resting };
  }
  throw Error("visual deadlock");
}
test("offset routing goes around Boss with swept clearance and cannot cross solids", () => {
  const boss: Vec3 = [0, 1.7, 8],
    a: Vec3 = [-4, 1.3, 8],
    b: Vec3 = [4, 1.3, 8];
  const route = safeOffsetRoute(a, b, boss, [a, b]);
  assert.ok(route);
  assert.ok(route.length > 2);
  for (let i = 1; i < route.length; i++)
    assert.ok(safeVisualSegment(route[i - 1], route[i], boss));
  assert.equal(
    safeVisualSegment([-4, 1.3, 0], [4, 1.3, 0], [15, 1.7, 15]),
    false,
    "command table cannot be crossed",
  );
});
test("Boss occupying delivery approach causes bounded wait then remote core transfer, never body collision", () => {
  const r = run(delivery(0), [11.5, 1.7, -14]);
  assert.ok(r.held && r.remote && r.transfer);
  assert.ok(r.now < 20000);
  assert.ok(r.min >= PERSONAL_SPACE - 1e-8);
  assert.deepEqual(
    liveSample(
      { roleId: "release-agent", status: "DONE" },
      null,
      r.now,
      true,
      r.resting,
    ).position,
    r.play.motion!.position,
    "no completion teleport",
  );
});
test("unobstructed Release walks, transfers and returns", () => {
  const r = run(delivery(0), [0, 1.7, 15]);
  assert.equal(r.remote, false);
  assert.ok(r.transfer);
  assert.deepEqual(r.resting["release-agent"], [12, 1.3, -12.5]);
});
test("blocked predecessor cannot starve admitted verified delivery; duplicates and stale refresh never replay", () => {
  const handoff: OfficeTransition = {
    ...delivery(1),
    id: "review:release",
    type: "HANDOFF",
    fromRole: "code-reviewer",
    toRole: "release-agent",
    status: "RUNNING",
  };
  let q = advanceVisualQueue(emptyVisualQueue(), [], 0, true);
  q = advanceVisualQueue(q, [handoff], 1, true);
  const resting: Record<string, Vec3> = {},
    boss: Vec3 = [11.5, 1.7, -11.4];
  let deliveryStarts = 0,
    previous = "",
    minimum = Infinity;
  for (let now = 1; now < 110000; now += 16) {
    if (q.current) {
      const m = stepVisualMotion(q.current, boss, now, resting);
      minimum = Math.min(
        minimum,
        Math.hypot(m.position[0] - boss[0], m.position[2] - boss[2]),
      );
    }
    q = advanceVisualQueue(
      q,
      now >= 1000 ? [handoff, delivery(1000)] : [handoff],
      now,
      true,
    );
    if (q.current?.event.id === "delivery:real" && previous !== "delivery:real")
      deliveryStarts++;
    previous = q.current?.event.id ?? "";
  }
  assert.ok(minimum >= PERSONAL_SPACE - 1e-8);
  assert.equal(deliveryStarts, 1);
  assert.equal(q.current, null);
  assert.equal(q.pending.length, 0);
  assert.equal(
    advanceVisualQueue(emptyVisualQueue(), [delivery(1000)], 120000, true)
      .current,
    null,
  );
  for (const status of ["FAILED", "DONE", "BLOCKED"])
    assert.equal(handoffPath({ ...delivery(0), status }), null);
});
test("a freshly admitted delivery survives waiting past freshness and wins over newer ordinary handoffs", () => {
  let q = advanceVisualQueue(emptyVisualQueue(), [], 0, true);
  q = advanceVisualQueue(q, [delivery(1)], 1, true);
  const first = q.current!;
  first.motion = stepVisualMotion(first, [0, 1.7, 15], 1, {});
  const second = { ...delivery(2), id: "delivery:second" };
  q = advanceVisualQueue(q, [second], 2, true);
  q = advanceVisualQueue(q, [], 65000, true);
  assert.equal(q.pending[0]?.id, second.id);
  first.motion.phase = "DONE";
  q = advanceVisualQueue(q, [], 65001, true);
  assert.equal(q.current?.event.id, second.id);
});
