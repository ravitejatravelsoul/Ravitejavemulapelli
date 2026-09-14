import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt, claimTask, updateTaskStatus, getTask, listTaskAttempts, getAgentRun } from "../../domain/tasks.ts";
import { upsertRunnerHeartbeat } from "../../domain/workspace.ts";
import { listOpenIncidents, listRecentIncidents } from "../../domain/office-incidents.ts";
import { computeOfficeHealthStatus } from "../../engineer/office-engineer.ts";
import { shouldSpawnRunner, detectStaleHeartbeat, beginDeadRunnerRecovery, completeRunnerRecovery, announceRunnerStarted, isActionableRunnerExit, shouldBackstopAct, SYMPTOM_RUNNER_OFFLINE } from "../supervisor.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

function setupProject(t: ReturnType<typeof createTestDb>) {
  const owner = getOwner(t.db)!;
  const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id });
  return { owner, project };
}

describe("shouldSpawnRunner — duplicate-runner prevention", () => {
  test("refuses to spawn when a fresh heartbeat already exists, even from a runner this instance never started", () => {
    const t = createTestDb();
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-manually-started", status: "IDLE" });
    const result = shouldSpawnRunner(t.db);
    assert.equal(result.spawn, false);
    assert.equal(result.existingRunnerId, "runner-manually-started");
    t.close();
  });

  test("allows spawning when no heartbeat has ever been recorded", () => {
    const t = createTestDb();
    const result = shouldSpawnRunner(t.db);
    assert.equal(result.spawn, true);
    t.close();
  });

  test("allows spawning once the existing heartbeat is stale beyond the threshold", () => {
    const t = createTestDb();
    const now = Date.now();
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-dead", status: "IDLE", now: now - 100_000 });
    const result = shouldSpawnRunner(t.db, 45_000, now);
    assert.equal(result.spawn, true);
    t.close();
  });

  // Real bug found during live testing of the actual supervisor script:
  // an `exit`-event-confirmed-dead runner's own last heartbeat write is
  // often only seconds old (it wrote a normal heartbeat, then died
  // shortly after) — time-elapsed alone can't distinguish that from a
  // genuinely different, still-healthy runner, so recovery kept refusing
  // to spawn a replacement for the exact runner it had just confirmed
  // dead via a real OS exit event.
  test("excludeRunnerId lets a CONFIRMED-dead runner's own still-recent heartbeat be ignored, while still refusing to spawn if a DIFFERENT runner is genuinely healthy", () => {
    const t = createTestDb();
    const now = Date.now();
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-just-died", status: "WORKING", now: now - 2_000 });

    const withoutExclude = shouldSpawnRunner(t.db, 45_000, now);
    assert.equal(withoutExclude.spawn, false, "sanity check: without the exclusion this would (wrongly) refuse to spawn");

    const withExclude = shouldSpawnRunner(t.db, 45_000, now, "runner-just-died");
    assert.equal(withExclude.spawn, true, "the confirmed-dead runner's own recent heartbeat must not block its own replacement");

    // A genuinely different, healthy runner must still block spawning.
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-other-healthy", status: "IDLE", now });
    const stillBlocked = shouldSpawnRunner(t.db, 45_000, now, "runner-just-died");
    assert.equal(stillBlocked.spawn, false);
    assert.equal(stillBlocked.existingRunnerId, "runner-other-healthy");

    t.close();
  });
});

describe("detectStaleHeartbeat", () => {
  test("reports not stale when no heartbeat exists yet (never a false 'dead' claim before the office has ever started)", () => {
    const t = createTestDb();
    assert.equal(detectStaleHeartbeat(t.db).stale, false);
    t.close();
  });

  test("reports stale once past the configured threshold, with the real age", () => {
    const t = createTestDb();
    const now = Date.now();
    upsertRunnerHeartbeat(t.db, { runnerId: "r1", status: "WORKING", now: now - 50_000 });
    const result = detectStaleHeartbeat(t.db, 45_000, now);
    assert.equal(result.stale, true);
    assert.equal(result.runnerId, "r1");
    assert.equal(result.ageMs, 50_000);
    t.close();
  });

  test("never reports stale merely because a single task is taking a long time — this is the exact false-positive class fixed at the source (heartbeat now updates on claim, not only after a full cycle)", () => {
    const t = createTestDb();
    const now = Date.now();
    // A heartbeat updated 30s ago (well within a real long Claude call's
    // duration) must not be treated as the runner being dead.
    upsertRunnerHeartbeat(t.db, { runnerId: "r1", status: "WORKING", now: now - 30_000 });
    assert.equal(detectStaleHeartbeat(t.db, 45_000, now).stale, false);
    t.close();
  });
});

describe("full self-healing sequence — runner healthy -> disappears -> detected -> task reclaimed -> runner recovers -> incident resolves", () => {
  test("end-to-end deterministic simulation of a real runner death and recovery, preserving all history", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const task = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "Implement backend" });

    // 1. Runner healthy.
    announceRunnerStarted(t.db, "runner-A");
    assert.equal(computeOfficeHealthStatus(t.db), "HEALTHY");

    // 2. Task IN_PROGRESS, claimed by runner-A, with a real attempt/run
    // already in flight — exactly the state a task is in mid-execution.
    const claimed = claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-A", leaseDurationMs: 5 * 60 * 1000 });
    assert.ok(claimed);
    updateTaskStatus(t.db, task.id, "IN_PROGRESS");
    const attempt = createTaskAttempt(t.db, task.id);
    const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "backend-developer", provider: "claude", model: "claude-sonnet-5" });
    assert.equal(getTask(t.db, task.id)?.status, "IN_PROGRESS");
    assert.equal(getTask(t.db, task.id)?.leaseOwnerId, "runner-A");

    // 3. Runner-A disappears (heartbeat goes stale — simulating the
    // process dying or hanging without a graceful shutdown).
    const now = Date.now();
    upsertRunnerHeartbeat(t.db, { runnerId: "runner-A", status: "WORKING", now: now - 60_000 });

    // 4. Office Engineer / supervisor detects the problem.
    const detection = detectStaleHeartbeat(t.db, 45_000, now);
    assert.equal(detection.stale, true);
    assert.equal(detection.runnerId, "runner-A");

    // 5. Task is safely reclaimed — real history preserved, never deleted.
    const { incident, tasksRecovered } = beginDeadRunnerRecovery(t.db, "runner-A");
    assert.deepEqual(tasksRecovered, [task.id]);
    assert.equal(incident.symptom, SYMPTOM_RUNNER_OFFLINE);
    assert.equal(getTask(t.db, task.id)?.status, "PENDING", "the task must become eligible again, not stuck or DONE");
    assert.equal(getTask(t.db, task.id)?.leaseOwnerId, null);
    assert.equal(getTask(t.db, task.id)?.attemptCount, 1, "attemptCount is never reset — the ceiling still applies");
    assert.equal(listTaskAttempts(t.db, task.id).length, 1, "the real attempt row is preserved, never deleted");
    assert.equal(listTaskAttempts(t.db, task.id)[0].status, "FAILED", "the interrupted attempt is closed out, never left RUNNING forever");
    assert.equal(getAgentRun(t.db, run.id)?.status, "FAILED");
    assert.equal(computeOfficeHealthStatus(t.db), "REPAIRING");

    // 6. Runner recovers/restarts — a fresh runner announces itself.
    const spawnCheck = shouldSpawnRunner(t.db, 45_000, now);
    assert.equal(spawnCheck.spawn, true, "the dead runner's stale heartbeat must not block a real replacement from starting");
    announceRunnerStarted(t.db, "runner-B");

    // 7. Execution continues — the reclaimed task is genuinely eligible
    // again (a real runner could claim it on its very next poll).
    const reclaimed = claimTask(t.db, { taskId: task.id, leaseOwnerId: "runner-B", leaseDurationMs: 5 * 60 * 1000 });
    assert.ok(reclaimed, "a fresh runner must be able to claim the recovered task");

    // 8. Incident resolves once the new runner's heartbeat is confirmed.
    const resolved = completeRunnerRecovery(t.db, incident.id, "runner-B");
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(computeOfficeHealthStatus(t.db), "HEALTHY");
    assert.equal(listOpenIncidents(t.db).length, 0);
    assert.equal(listRecentIncidents(t.db).length, 1, "the resolved incident's own history is preserved, never deleted");

    t.close();
  });

  test("never starts a duplicate runner even immediately after a real recovery — the just-restarted runner-B is itself the fresh heartbeat", () => {
    const t = createTestDb();
    announceRunnerStarted(t.db, "runner-B");
    const result = shouldSpawnRunner(t.db);
    assert.equal(result.spawn, false);
    assert.equal(result.existingRunnerId, "runner-B");
    t.close();
  });

  test("an incident that cannot be safely resolved (no replacement runner confirmed) is escalated, never silently marked resolved", () => {
    const t = createTestDb();
    const { incident } = beginDeadRunnerRecovery(t.db, "runner-dead");
    const result = completeRunnerRecovery(t.db, incident.id, null);
    assert.equal(result.status, "ESCALATED");
    assert.equal(computeOfficeHealthStatus(t.db), "ESCALATED");
    t.close();
  });

  test("recovering from the same dead runner twice does not create duplicate incidents", () => {
    const t = createTestDb();
    const { project } = setupProject(t);
    const taskA = createTask(t.db, { projectId: project.id, roleId: "backend-developer", title: "A" });
    const taskB = createTask(t.db, { projectId: project.id, roleId: "frontend-developer", title: "B" });
    claimTask(t.db, { taskId: taskA.id, leaseOwnerId: "runner-A", leaseDurationMs: 300_000 });
    updateTaskStatus(t.db, taskA.id, "IN_PROGRESS");
    claimTask(t.db, { taskId: taskB.id, leaseOwnerId: "runner-A", leaseDurationMs: 300_000 });
    updateTaskStatus(t.db, taskB.id, "IN_PROGRESS");

    const first = beginDeadRunnerRecovery(t.db, "runner-A");
    const second = beginDeadRunnerRecovery(t.db, "runner-A");
    assert.equal(first.incident.id, second.incident.id, "a second detection of the same still-open incident must reuse it, never duplicate");
    assert.equal(listRecentIncidents(t.db).length, 1);

    t.close();
  });
});

// Real bug found during live testing of the actual ai-office-dev.ts
// supervisor script — not a hypothetical. The runner-child `exit` event
// and the periodic heartbeat-staleness backstop are two independent
// triggers with no coordination; both fired within the same window and
// each spawned a replacement runner, producing two live runners that
// concurrently claimed and paid for the SAME task (two real Claude calls
// for the same backend-developer attempt created 725ms apart — an
// interval impossible for one serialized runner, whose poll interval is
// 5s and whose calls take 45-60s). These pure functions are the exact
// guard logic `ai-office-dev.ts` now uses to serialize the two triggers.
describe("isActionableRunnerExit / shouldBackstopAct — the exact duplicate-spawn race fix", () => {
  test("a tracked runner's exit is actionable when idle (no shutdown, no recovery already running)", () => {
    assert.equal(isActionableRunnerExit({ shuttingDown: false, recoveryInFlight: false, exitedIsCurrentlyTracked: true }), true);
  });

  test("an exit is ignored while a recovery is already in flight — prevents the second trigger from spawning a duplicate runner", () => {
    assert.equal(isActionableRunnerExit({ shuttingDown: false, recoveryInFlight: true, exitedIsCurrentlyTracked: true }), false);
  });

  test("a stray/delayed exit from a runner already superseded by a newer one is ignored — must never be treated as the current runner failing", () => {
    assert.equal(isActionableRunnerExit({ shuttingDown: false, recoveryInFlight: false, exitedIsCurrentlyTracked: false }), false);
  });

  test("no exit is actionable during a deliberate shutdown", () => {
    assert.equal(isActionableRunnerExit({ shuttingDown: true, recoveryInFlight: false, exitedIsCurrentlyTracked: true }), false);
  });

  test("the heartbeat backstop acts on a genuinely stale heartbeat when idle", () => {
    assert.equal(shouldBackstopAct({ shuttingDown: false, recoveryInFlight: false, stale: true }), true);
  });

  test("the heartbeat backstop stays silent while the exit-event path already has a recovery in flight — this is the other half of the same race fix", () => {
    assert.equal(shouldBackstopAct({ shuttingDown: false, recoveryInFlight: true, stale: true }), false);
  });

  test("the heartbeat backstop never acts on a fresh heartbeat regardless of other flags", () => {
    assert.equal(shouldBackstopAct({ shuttingDown: false, recoveryInFlight: false, stale: false }), false);
  });
});
