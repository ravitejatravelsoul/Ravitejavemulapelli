import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceVisualQueue,
  emptyVisualQueue,
  shouldGreet,
  playbackDuration,
  playbackPhase,
  dagStatus,
  proximityBriefing,
  briefSignature,
} from "../experience.ts";
import { handoffPath, liveSample, ROLE_STATIONS } from "../presentation.ts";
import type { OfficeTransition } from "../../dashboard/office-transitions.ts";
import { createTestDb } from "../../db/test-helpers.ts";
import { recordFailure } from "../../domain/project-outputs.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import {
  createTask,
  createTaskAttempt,
  createAgentRunForAttempt,
  updateTaskStatus,
  updateAgentRunStatus,
} from "../../domain/tasks.ts";
import { getAIHeadquartersWorldState } from "../world-state.ts";
const event = (id: string, at: number): OfficeTransition => ({
  id,
  occurredAt: at,
  projectId: "p",
  taskId: "t",
  attempt: 1,
  fromRole: "product-owner",
  toRole: "solution-architect",
  type: "HANDOFF",
  evidenceId: "run",
  status: "RUNNING",
  label: "Real dependency",
});
test("bounded newest-first queue consumes initial/hidden history, deduplicates and drops stale transitions", () => {
  let q = advanceVisualQueue(
    emptyVisualQueue(),
    [event("history", 100)],
    100,
    true,
  );
  assert.equal(q.current, null);
  q = advanceVisualQueue(q, [event("live", 101)], 101, true);
  assert.equal(q.current?.event.id, "live");
  q = advanceVisualQueue(
    q,
    Array.from({ length: 8 }, (_, i) => event("n" + i, 102 + i)),
    110,
    true,
  );
  assert.deepEqual(
    q.pending.map((e) => e.id),
    ["n7", "n6", "n5"],
  );
  assert.equal(q.current?.event.id, "live");
  q = advanceVisualQueue(
    q,
    [event("n7", 109), event("history", 100)],
    111,
    true,
  );
  assert.equal(q.pending.length, 3);
  q = advanceVisualQueue(q, [], 100000, true);
  assert.equal(q.current, null);
  assert.equal(q.pending.length, 0);
  q = advanceVisualQueue(q, [event("hidden", 100001)], 100001, false);
  assert.equal(q.current, null);
  q = advanceVisualQueue(q, [event("hidden", 100001)], 100002, true);
  assert.equal(q.current, null);
  assert.equal(
    advanceVisualQueue(
      emptyVisualQueue(),
      [event("refresh", 100003)],
      100003,
      true,
    ).current,
    null,
  );
});
test("greeting cooldown permits meaningful changes, not repeated proximity", () => {
  const p = { at: 1000, signature: "same" };
  assert.equal(shouldGreet(p, "same", 89999), false);
  assert.equal(shouldGreet(p, "same", 91000), true);
  assert.equal(shouldGreet(p, "changed", 1001), true);
});
test("handoff carries, transfers, acknowledges and returns continuously without changing authoritative status", () => {
  const e = event("transfer", 100),
    path = handoffPath(e)!;
  assert.ok(path);
  const durationMs = playbackDuration(path),
    p = { event: e, path, startedAt: 100, durationMs };
  assert.equal(playbackPhase(p, 100 + durationMs * 0.5), "TRANSFER");
  assert.equal(
    liveSample(
      { roleId: e.fromRole, status: "DONE" },
      p,
      100 + durationMs * 0.2,
      true,
    ).carry,
    true,
  );
  assert.equal(
    liveSample(
      { roleId: e.toRole, status: "WORKING" },
      p,
      100 + durationMs * 0.5,
      true,
    ).state,
    "HANDOFF",
  );
  let previous = liveSample(
    { roleId: e.fromRole, status: "DONE" },
    p,
    100,
    true,
  ).position;
  for (let ms = 16; ms <= durationMs; ms += 16) {
    const s = liveSample(
      { roleId: e.fromRole, status: "DONE" },
      p,
      100 + ms,
      true,
    );
    assert.ok(
      Math.hypot(s.position[0] - previous[0], s.position[2] - previous[2]) <
        0.25,
    );
    previous = s.position;
  }
  assert.deepEqual(
    liveSample(
      { roleId: e.fromRole, status: "DONE" },
      p,
      101 + durationMs,
      true,
    ).position,
    ROLE_STATIONS[e.fromRole].home,
  );
  assert.deepEqual(
    liveSample(
      { roleId: e.fromRole, status: "DONE" },
      p,
      100 + durationMs * 0.2,
      false,
    ).position,
    ROLE_STATIONS[e.fromRole].home,
  );
});
test("delivery ceremony fails closed and DAG maps actual task states", () => {
  for (const status of ["FAILED", "BLOCKED", "READY_FOR_REVIEW", "DONE"])
    assert.equal(
      handoffPath({
        ...event("d", 100),
        type: "DELIVERY",
        fromRole: "release-agent",
        toRole: "delivery",
        status,
      }),
      null,
    );
  assert.ok(
    handoffPath({
      ...event("d", 100),
      type: "DELIVERY",
      fromRole: "release-agent",
      toRole: "delivery",
      status: "VERIFIED",
    }),
  );
  assert.deepEqual(
    ["DONE", "IN_PROGRESS", "PENDING", "BLOCKED", "FAILED"].map(dagStatus),
    ["DONE", "WORKING", "WAITING", "BLOCKED", "FAILED"],
  );
});
test("active QA proximity briefing is grounded in persisted task, route and attempt", () => {
  process.env.OFFICE_OWNER_EMAIL = "acceptance@example.test";
  process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic";
  const t = createTestDb();
  try {
    const { project } = createProjectWithIdea(t.db, {
      title: "Reading desk",
      rawIdeaText: "NEVER EXPOSE PRIVATE IDEA",
      ownerId: getOwner(t.db)!.id,
      routingMode: "FREE_MULTI_MODEL",
    });
    const task = createTask(t.db, {
      projectId: project.id,
      roleId: "qa-agent",
      title: "Test reading filters",
    });
    updateTaskStatus(t.db, task.id, "IN_PROGRESS");
    const attempt = createTaskAttempt(t.db, task.id),
      run = createAgentRunForAttempt(t.db, {
        taskAttemptId: attempt.id,
        roleId: task.roleId,
        provider: "groq",
        model: "approved-model",
      });
    updateAgentRunStatus(t.db, run.id, "RUNNING");
    const s = getAIHeadquartersWorldState(t.db, project.id),
      a = s.agents.find((a) => a.roleId === "qa-agent")!;
    assert.equal(a.status, "TESTING");
    assert.equal(s.tasks[0].visualStatus, "TESTING");
    const text = proximityBriefing(a, s, 9);
    for (const fact of [
      "Good morning",
      "testing",
      "Test reading filters",
      "groq / approved-model",
      "Attempt 1",
      "No recorded blocker",
    ])
      assert.ok(text.includes(fact), fact);
    assert.ok(!text.includes("PRIVATE"));
    recordFailure(t.db, {
      projectId: project.id,
      taskId: task.id,
      agentRunId: run.id,
      reason: "UNSAFE_RAW_PROVIDER_FAILURE secret and private reasoning",
    });
    const failed = getAIHeadquartersWorldState(t.db, project.id);
    assert.ok(!JSON.stringify(failed).includes("UNSAFE_RAW_PROVIDER_FAILURE"));
    assert.match(
      failed.agents.find((a) => a.roleId === "qa-agent")!.blocker!,
      /recorded task failure needs review/,
    );

    assert.notEqual(
      briefSignature(a, project.id),
      briefSignature({ ...a, status: "DONE" }, project.id),
    );
  } finally {
    t.close();
  }
});
