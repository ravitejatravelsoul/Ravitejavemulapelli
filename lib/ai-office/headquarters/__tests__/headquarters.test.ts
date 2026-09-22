import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import {
  createProjectWithIdea,
  updateProjectStatus,
} from "../../domain/projects.ts";
import {
  createTask,
  createTaskAttempt,
  createAgentRunForAttempt,
  updateTaskStatus,
  updateAgentRunStatus,
  addTaskDependency,
} from "../../domain/tasks.ts";
import { recordEvent } from "../../domain/events.ts";
import { createApproval } from "../../domain/project-outputs.ts";
import {
  approveApproval,
  rejectApproval,
} from "../../approvals/approval-service.ts";
import { recordAiUsage } from "../../domain/budget.ts";
import {
  createIncident,
  updateIncident,
} from "../../domain/office-incidents.ts";
import { setDeliveryState } from "../../domain/workspace.ts";
import { getAIHeadquartersWorldState, safeWorldText } from "../world-state.ts";
import {
  agentBriefing,
  ROLE_STATIONS,
  HEADQUARTERS_CAMPUS,
  visualDefinition,
  handoffPath,
  latestTransition,
  liveSample,
} from "../presentation.ts";
import { canStandInWorld } from "../../../../components/ai-office/world-prototype/world-campus.ts";
process.env.OFFICE_OWNER_EMAIL = "hq@example.test";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic";
function fixture() {
  const t = createTestDb();
  const { project } = createProjectWithIdea(t.db, {
    title: "Actual project",
    rawIdeaText: "PRIVATE_PROMPT_NEVER_SERIALIZE",
    ownerId: getOwner(t.db)!.id,
    routingMode: "FREE_MULTI_MODEL",
  });
  return { ...t, project };
}
test("allowlisted world DTO has grounded task/run/cost and never prompts, event payloads, diagnoses or configured secrets; zero inference", () => {
  const t = fixture(),
    fetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("No network");
  };
  process.env.TEST_API_KEY = "configured-secret-hq-example";
  try {
    const task = createTask(t.db, {
      projectId: t.project.id,
      roleId: "frontend-developer",
      title: "Implement actual UI",
    });
    updateTaskStatus(t.db, task.id, "IN_PROGRESS");
    let s = getAIHeadquartersWorldState(t.db, t.project.id);
    assert.equal(
      s.agents.find((a) => a.roleId === "frontend-developer")!.provider,
      null,
    );
    const attempt = createTaskAttempt(t.db, task.id),
      run = createAgentRunForAttempt(t.db, {
        taskAttemptId: attempt.id,
        roleId: task.roleId,
        provider: "groq",
        model: "actual-model",
      });
    recordAiUsage(t.db, {
      projectId: t.project.id,
      agentRunId: run.id,
      provider: "groq",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0,
    });
    recordEvent(t.db, {
      projectId: t.project.id,
      type: "agent_run.failed",
      actor: task.roleId,
      payload: {
        taskId: task.id,
        prompt: "RAW_PROMPT",
        reasoning: "PRIVATE_REASONING",
        apiKey: process.env.TEST_API_KEY,
      },
    });
    createIncident(t.db, {
      symptom: "runner-offline",
      diagnosis: "PRIVATE_DIAGNOSIS",
    });
    s = getAIHeadquartersWorldState(t.db, t.project.id);
    const a = s.agents.find((a) => a.roleId === task.roleId)!;
    assert.equal(a.task, "Implement actual UI");
    assert.equal(a.provider, "groq");
    assert.equal(a.model, "actual-model");
    assert.equal(a.attempt, 1);
    assert.equal(a.tokens, 120);
    assert.equal(a.costUsd, 0);
    assert.match(
      agentBriefing(a, s, 9),
      /Good morning, Boss.*Actual project.*Implement actual UI.*groq.*actual-model.*Attempt 1/,
    );
    for (const secret of [
      "PRIVATE_PROMPT",
      "RAW_PROMPT",
      "PRIVATE_REASONING",
      "PRIVATE_DIAGNOSIS",
      process.env.TEST_API_KEY!,
    ])
      assert.ok(!JSON.stringify(s).includes(secret));
    assert.equal(safeWorldText(process.env.TEST_API_KEY), "[redacted]");
    assert.equal(calls, 0);
    assert.equal(
      getAIHeadquartersWorldState(t.db, t.project.id).revision,
      s.revision,
    );
  } finally {
    globalThis.fetch = fetch;
    delete process.env.TEST_API_KEY;
    t.close();
  }
});
test("approval decisions reuse exact domain service and incident states remain factual", () => {
  const t = fixture();
  try {
    for (const decision of ["approve", "reject"]) {
      const a = createApproval(t.db, {
        projectId: t.project.id,
        kind: "budget_increase",
        requestedBy: "orchestrator",
        context: { reason: "Recorded request", estimatedCostUsd: 0.25 },
      });
      let s = getAIHeadquartersWorldState(t.db, t.project.id);
      assert.equal(s.approvals[0].reason, "Recorded request");
      assert.equal(s.approvals[0].estimatedCostUsd, 0.25);
      const input = { approvalId: a.id, decidedByUserId: getOwner(t.db)!.id };
      assert.ok(
        (decision === "approve"
          ? approveApproval(t.db, input)
          : rejectApproval(t.db, input)
        ).ok,
      );
      s = getAIHeadquartersWorldState(t.db, t.project.id);
      assert.ok(!s.approvals.some((x) => x.id === a.id));
    }
    const incident = createIncident(t.db, {
      symptom: "runner-offline",
      projectId: t.project.id,
    });
    for (const status of [
      "WATCHING",
      "INVESTIGATING",
      "REPAIRING",
      "VERIFYING",
      "ESCALATED",
      "RESOLVED",
    ] as const) {
      updateIncident(t.db, incident.id, {
        status,
        resolvedAt: status === "RESOLVED" ? Date.now() : null,
      });
      const s = getAIHeadquartersWorldState(t.db, t.project.id);
      assert.equal(s.incidents[0].status, status);
      assert.equal(s.office.health === "HEALTHY", status === "RESOLVED");
    }
  } finally {
    t.close();
  }
});
test("vault excludes failed, blocked and unverified READY projects even with stale verification", () => {
  const t = fixture();
  try {
    const task = createTask(t.db, {
      projectId: t.project.id,
      roleId: "release-agent",
      title: "Release",
    });
    updateTaskStatus(t.db, task.id, "DONE");
    for (const status of ["FAILED", "BLOCKED", "READY_FOR_REVIEW"] as const) {
      updateProjectStatus(t.db, t.project.id, status);
      setDeliveryState(
        t.db,
        t.project.id,
        status === "READY_FOR_REVIEW" ? "FAILED" : "VERIFIED",
      );
      assert.equal(
        getAIHeadquartersWorldState(t.db, t.project.id).deliveries.length,
        0,
      );
    }
    setDeliveryState(t.db, t.project.id, "VERIFIED");
    assert.equal(
      getAIHeadquartersWorldState(t.db, t.project.id).deliveries.length,
      1,
    );
    updateTaskStatus(t.db, task.id, "IN_PROGRESS");
    assert.equal(
      getAIHeadquartersWorldState(t.db, t.project.id).deliveries.length,
      0,
    );
  } finally {
    t.close();
  }
});
test("physical handoffs require persisted completed predecessor and started successor; remediation and reconnect are bounded", () => {
  const t = fixture();
  try {
    const a = createTask(t.db, {
        projectId: t.project.id,
        roleId: "product-owner",
        title: "Requirements",
      }),
      b = createTask(t.db, {
        projectId: t.project.id,
        roleId: "solution-architect",
        title: "Architecture",
      });
    addTaskDependency(t.db, b.id, a.id);
    const aa = createTaskAttempt(t.db, a.id),
      ra = createAgentRunForAttempt(t.db, {
        taskAttemptId: aa.id,
        roleId: a.roleId,
        provider: "groq",
      });
    assert.equal(
      getAIHeadquartersWorldState(t.db, t.project.id).transitions.filter(
        (e) => e.type === "HANDOFF",
      ).length,
      0,
    );
    updateAgentRunStatus(t.db, ra.id, "SUCCEEDED", Date.now() - 10);
    updateTaskStatus(t.db, a.id, "DONE");
    const ab = createTaskAttempt(t.db, b.id);
    const rb = createAgentRunForAttempt(t.db, {
      taskAttemptId: ab.id,
      roleId: b.roleId,
      provider: "groq",
    });
    updateAgentRunStatus(t.db, rb.id, "RUNNING");
    let s = getAIHeadquartersWorldState(t.db, t.project.id);
    const e = s.transitions.find((e) => e.type === "HANDOFF")!;
    assert.ok(e);
    assert.ok(handoffPath(e));
    const seen = new Set<string>();
    assert.equal(
      latestTransition(s.transitions, seen, Date.now(), false),
      null,
    );
    assert.equal(latestTransition(s.transitions, seen, Date.now(), true), null);
    assert.equal(
      latestTransition(s.transitions, new Set(), Date.now() + 30000, true),
      null,
    );
    const path = handoffPath(e)!;
    assert.notDeepEqual(
      liveSample(
        { roleId: a.roleId, status: "IDLE" },
        { event: e, path, startedAt: 100 },
        3100,
        true,
      ).position,
      ROLE_STATIONS[a.roleId].home,
    );
    assert.deepEqual(
      liveSample(
        { roleId: a.roleId, status: "IDLE" },
        { event: e, path, startedAt: 100 },
        3100,
        false,
      ).position,
      ROLE_STATIONS[a.roleId].home,
    );
    for (const role of ["qa-agent", "security-reviewer", "code-reviewer"]) {
      const review = createTask(t.db, {
        projectId: t.project.id,
        roleId: role,
        title: "Review",
      });
      recordEvent(t.db, {
        projectId: t.project.id,
        type: "agent_run.failed",
        actor: role,
        payload: {
          taskId: review.id,
          remediationTargetTaskIds: [b.id],
          attemptNumber: 1,
        },
      });
    }
    s = getAIHeadquartersWorldState(t.db, t.project.id);
    assert.equal(
      s.transitions.filter((e) => e.type === "REMEDIATION").length,
      3,
    );
  } finally {
    t.close();
  }
});
test("all seeded roles and maintenance have collision-clear docks and connected navigation, without fixed actor array size", () => {
  const t = fixture();
  try {
    const s = getAIHeadquartersWorldState(t.db, t.project.id);
    assert.equal(s.agents.length, 11);
    for (const a of s.agents) assert.ok(visualDefinition(a));
    for (const slot of Object.values(ROLE_STATIONS))
      assert.ok(
        canStandInWorld(
          HEADQUARTERS_CAMPUS,
          "floor-50",
          slot.home[0],
          slot.home[2],
        ),
        slot.room,
      );
    for (const e of HEADQUARTERS_CAMPUS.edges) {
      if (!e.enabled || e.kind !== "walk") continue;
      const a = HEADQUARTERS_CAMPUS.nodes.find((n) => n.id === e.from)!,
        b = HEADQUARTERS_CAMPUS.nodes.find((n) => n.id === e.to)!;
      if (a.floorId !== "floor-50") continue;
      for (let i = 0; i <= 30; i++) {
        const f = i / 30;
        assert.ok(
          canStandInWorld(
            HEADQUARTERS_CAMPUS,
            a.floorId,
            a.position[0] + (b.position[0] - a.position[0]) * f,
            a.position[2] + (b.position[2] - a.position[2]) * f,
          ),
          e.from + " -> " + e.to,
        );
      }
    }
  } finally {
    t.close();
  }
});

test("model fallback telemetry, budget and remote mode project only recorded safe fields", async () => {
  const t = fixture();
  try {
    const { recordRoutingDecision } =
      await import("../../domain/model-registry.ts");
    recordRoutingDecision(t.db, {
      projectId: t.project.id,
      roleId: "frontend-developer",
      requiredCapability: "coding",
      candidateModels: [],
      selectedProvider: "groq",
      selectedModel: "first",
      selectionReason: "PRIVATE_ROUTER_REASON",
      fallbacksUsed: [
        { provider: "openrouter", modelId: "second:free", score: 1 },
      ],
      attempts: 2,
      result: "SUCCEEDED",
      costUsd: 0,
    });
    const s = getAIHeadquartersWorldState(t.db, t.project.id, "remote");
    assert.equal(s.office.runner, "REMOTE_SNAPSHOT");
    assert.equal(s.routing[0].attempts, 2);
    assert.deepEqual(s.routing[0].fallbacks, [
      { provider: "openrouter", model: "second:free" },
    ]);
    assert.ok(!JSON.stringify(s).includes("PRIVATE_ROUTER_REASON"));
    assert.equal(s.budget.spendUsd, 0);
    assert.ok(s.budget.capUsd >= s.budget.remainingUsd);
    updateProjectStatus(t.db, t.project.id, "PAUSED");
    const paused = getAIHeadquartersWorldState(t.db, t.project.id);
    assert.equal(paused.project?.status, "PAUSED");
  } finally {
    t.close();
  }
});

test("cooldown expiration changes the conditional revision without another model call", async () => {
  const t = fixture();
  try {
    const { upsertModelRegistryEntry } =
      await import("../../domain/model-registry.ts");
    const m = upsertModelRegistryEntry(t.db, {
      provider: "groq",
      modelId: "fixture",
      displayName: "Fixture",
      capabilities: ["CODING"],
    });
    const now = Date.now();
    t.db
      .prepare("UPDATE model_registry SET rateLimitedUntil=? WHERE id=?")
      .run(now + 1000, m.id);
    const before = getAIHeadquartersWorldState(
        t.db,
        t.project.id,
        "local",
        now,
      ),
      after = getAIHeadquartersWorldState(
        t.db,
        t.project.id,
        "local",
        now + 1001,
      );
    assert.equal(before.models[0].coolingDown, true);
    assert.equal(after.models[0].coolingDown, false);
    assert.notEqual(before.revision, after.revision);
  } finally {
    t.close();
  }
});

test("main side aisles remain clear of docked agent collision volumes", () => {
  for (const [x, start, end] of [
    [-15.2, -3, -10],
    [11.5, -3, -10],
  ])
    for (let i = 0; i <= 100; i++) {
      const z = start + ((end - start) * i) / 100;
      assert.ok(canStandInWorld(HEADQUARTERS_CAMPUS, "floor-50", x, z));
      for (const [id, slot] of Object.entries(ROLE_STATIONS))
        assert.ok(
          Math.hypot(x - slot.home[0], z - slot.home[2]) > 0.82,
          "aisle blocked by " + id,
        );
    }
});
