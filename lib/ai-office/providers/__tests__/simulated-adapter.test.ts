import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SimulatedAdapter } from "../simulated/simulated-adapter.ts";
import { AGENT_ROLE_CATALOG } from "../../domain/agent-role-catalog.ts";
import type { TaskContext } from "../types.ts";

function context(roleId: string, scenario?: string): TaskContext {
  return {
    projectId: "p1",
    taskId: "t1",
    roleId,
    taskTitle: "Test task",
    projectSummary: "",
    authoritativeUserRequest: "Build a small internal tool.",
    projectTitle: "Test Project",
    relevantArtifacts: [],
    relevantDecisions: [],
    scenario,
  };
}

describe("provider interface behavior", () => {
  test("SimulatedAdapter.name is 'simulated'", () => {
    assert.equal(new SimulatedAdapter().name, "simulated");
  });

  test("estimateCost always returns zero, regardless of role/scenario", () => {
    const adapter = new SimulatedAdapter();
    for (const role of AGENT_ROLE_CATALOG) {
      const estimate = adapter.estimateCost({ role: role.id, task: context(role.id), instructions: "x" });
      assert.deepEqual(estimate, { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 });
    }
  });

  test("runAgentTask throws a clear error for an unknown role", async () => {
    const adapter = new SimulatedAdapter();
    await assert.rejects(() => adapter.runAgentTask({ role: "not-a-real-role", task: context("not-a-real-role"), instructions: "x" }));
  });
});

describe("every approved role has at least success + failure fixture coverage", () => {
  for (const role of AGENT_ROLE_CATALOG) {
    test(`${role.id}: success fixture produces a SUCCEEDED result with $0 cost`, async () => {
      const adapter = new SimulatedAdapter();
      const result = await adapter.runAgentTask({ role: role.id, task: context(role.id, "success"), instructions: "x" });
      assert.equal(result.status, "SUCCEEDED");
      assert.equal(result.usage.costUsd, 0);
      assert.ok(result.output.summary.length > 0);
    });

    test(`${role.id}: failure fixture produces a FAILED result with a reason and $0 cost`, async () => {
      const adapter = new SimulatedAdapter();
      const result = await adapter.runAgentTask({ role: role.id, task: context(role.id, "failure"), instructions: "x" });
      assert.equal(result.status, "FAILED");
      assert.equal(result.usage.costUsd, 0);
      assert.ok(result.output.failure?.reason && result.output.failure.reason.length > 0);
    });
  }

  test("all 11 approved roles are covered (no silent gaps)", () => {
    assert.equal(AGENT_ROLE_CATALOG.length, 11);
  });
});

describe("developer roles additionally support a retry-success fixture", () => {
  for (const roleId of ["frontend-developer", "backend-developer"]) {
    test(`${roleId}: retry-success fixture differs from the first-attempt success fixture`, async () => {
      const adapter = new SimulatedAdapter();
      const first = await adapter.runAgentTask({ role: roleId, task: context(roleId, "success"), instructions: "x" });
      const retry = await adapter.runAgentTask({ role: roleId, task: context(roleId, "retry-success"), instructions: "x" });
      assert.equal(retry.status, "SUCCEEDED");
      assert.notEqual(retry.output.summary, first.output.summary, "a retry-success fixture should read as a fix, not a repeat");
    });
  }
});

describe("frontend-developer writes real files; backend-developer stays text-only (Phase 8)", () => {
  test("frontend-developer's success fixture requests writing index.html/styles.css/script.js, with a deliberately buggy script.js", async () => {
    const adapter = new SimulatedAdapter();
    const result = await adapter.runAgentTask({ role: "frontend-developer", task: context("frontend-developer", "success"), instructions: "x" });
    assert.equal(result.status, "SUCCEEDED");
    const paths = result.output.fileOperations.map((op) => op.path).sort();
    assert.deepEqual(paths, ["index.html", "script.js", "styles.css"]);
    const script = result.output.fileOperations.find((op) => op.path === "script.js")!;
    assert.match(script.content!, /getElementById\("greeting"\)/, "attempt 1 must contain the deliberate wrong-id bug");
    const html = result.output.fileOperations.find((op) => op.path === "index.html")!;
    assert.match(html.content!, /<h1>/i);
    assert.match(html.content!, /id="message"/);
    assert.match(html.content!, /id="greet-button"/);
  });

  test("frontend-developer's retry-success fixture rewrites only script.js, with the id bug fixed", async () => {
    const adapter = new SimulatedAdapter();
    const result = await adapter.runAgentTask({ role: "frontend-developer", task: context("frontend-developer", "retry-success"), instructions: "x" });
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.output.fileOperations.length, 1);
    const script = result.output.fileOperations[0]!;
    assert.equal(script.path, "script.js");
    assert.match(script.content!, /getElementById\("message"\)/, "the fix must reference the id that actually exists in index.html");
    assert.doesNotMatch(script.content!, /getElementById\("greeting"\)/);
  });

  test("backend-developer never requests any file operation — a static page has no backend", async () => {
    const adapter = new SimulatedAdapter();
    const success = await adapter.runAgentTask({ role: "backend-developer", task: context("backend-developer", "success"), instructions: "x" });
    const retry = await adapter.runAgentTask({ role: "backend-developer", task: context("backend-developer", "retry-success"), instructions: "x" });
    assert.deepEqual(success.output.fileOperations, []);
    assert.deepEqual(retry.output.fileOperations, []);
  });
});

describe("deterministic fixture selection — no randomness", () => {
  test("the same role+scenario produces byte-identical output across repeated calls", async () => {
    const adapter = new SimulatedAdapter();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => adapter.runAgentTask({ role: "qa-agent", task: context("qa-agent", "failure"), instructions: "x" })),
    );
    for (const r of results) {
      assert.deepEqual(r, results[0]);
    }
  });

  test("omitting scenario defaults to the success fixture", async () => {
    const adapter = new SimulatedAdapter();
    const withDefault = await adapter.runAgentTask({ role: "qa-agent", task: context("qa-agent", undefined), instructions: "x" });
    const explicit = await adapter.runAgentTask({ role: "qa-agent", task: context("qa-agent", "success"), instructions: "x" });
    assert.deepEqual(withDefault, explicit);
  });
});
