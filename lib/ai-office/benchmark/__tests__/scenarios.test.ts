import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BENCHMARK_SCENARIOS, getBenchmarkScenario } from "../scenarios.ts";
import type { AgentTaskResult } from "../../providers/types.ts";

function succeeded(overrides: Partial<AgentTaskResult["output"]> = {}): AgentTaskResult {
  return {
    status: "SUCCEEDED",
    output: {
      summary: "",
      artifacts: [],
      decisions: [],
      testResults: [],
      events: [],
      fileOperations: [],
      recommendedNextActions: [],
      ...overrides,
    },
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

function failed(reason: string): AgentTaskResult {
  return {
    status: "FAILED",
    output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason } },
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

describe("BENCHMARK_SCENARIOS", () => {
  test("exactly the six specified scenarios exist, each with a real buildInput and evaluate", () => {
    assert.equal(BENCHMARK_SCENARIOS.length, 6);
    const ids = BENCHMARK_SCENARIOS.map((s) => s.id).sort();
    assert.deepEqual(ids, ["architect-static-page", "code-review", "frontend-build", "frontend-bug-fix", "product-owner-basic", "qa-interpretation"].sort());
    for (const scenario of BENCHMARK_SCENARIOS) {
      const input = scenario.buildInput();
      assert.equal(input.role, scenario.roleId);
      assert.ok(input.task.authoritativeUserRequest.length > 0);
    }
  });

  test("every scenario evaluates an adapter-level failure as FAIL, regardless of scenario-specific content", () => {
    for (const scenario of BENCHMARK_SCENARIOS) {
      const evaluation = scenario.evaluate(failed("Ollama request timed out after 120000ms."));
      assert.equal(evaluation.status, "FAIL");
    }
  });

  test("getBenchmarkScenario throws on an unknown id", () => {
    assert.throws(() => getBenchmarkScenario("nonexistent" as never));
  });
});

describe("product-owner-basic evaluation", () => {
  const scenario = getBenchmarkScenario("product-owner-basic");

  test("PASS: covers heading/description/button with no backend drift", () => {
    const evaluation = scenario.evaluate(succeeded({ summary: "Requirements: a heading, a short description, and a button that changes text." }));
    assert.equal(evaluation.status, "PASS");
  });

  test("FAIL: drifts toward an unrequested backend concept", () => {
    const evaluation = scenario.evaluate(
      succeeded({ summary: "Requirements: heading, description, button, backed by a REST API and a database for persistence." }),
    );
    assert.equal(evaluation.status, "FAIL");
  });

  test("PARTIAL: produced something but missed a required element", () => {
    const evaluation = scenario.evaluate(succeeded({ summary: "Requirements: a heading and a button." }));
    assert.equal(evaluation.status, "PARTIAL");
  });
});

describe("architect-static-page evaluation", () => {
  const scenario = getBenchmarkScenario("architect-static-page");

  test("PASS: static/frontend-only architecture, no backend", () => {
    const evaluation = scenario.evaluate(succeeded({ summary: "A single static HTML page, no backend, plain client-side JS." }));
    assert.equal(evaluation.status, "PASS");
  });

  test("FAIL: invents a backend for a static page", () => {
    const evaluation = scenario.evaluate(succeeded({ summary: "A Node.js server with a REST API and a database backing the page." }));
    assert.equal(evaluation.status, "FAIL");
  });
});

describe("frontend-build evaluation", () => {
  const scenario = getBenchmarkScenario("frontend-build");
  const goodHtml = '<!doctype html><html><body><h1>Hello, World!</h1><p>Welcome</p><button id="b">Click</button><script src="script.js"></script></body></html>';

  test("PASS: valid fileOperations with heading, button, and linked script", () => {
    const evaluation = scenario.evaluate(
      succeeded({ fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: goodHtml }] }),
    );
    assert.equal(evaluation.status, "PASS");
    assert.equal(evaluation.fileOperationValid, true);
  });

  test("FAIL: no file operations produced at all", () => {
    const evaluation = scenario.evaluate(succeeded({ fileOperations: [] }));
    assert.equal(evaluation.status, "FAIL");
  });

  test("PARTIAL: has a heading but missing the button/script linkage", () => {
    const evaluation = scenario.evaluate(
      succeeded({
        fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: "<html><body><h1>Hello, World!</h1></body></html>" }],
      }),
    );
    assert.equal(evaluation.status, "PARTIAL");
  });

  test("PARTIAL, never PASS: correct code content placed only in an artifact, zero fileOperations (Part 8 — output-channel compliance)", () => {
    const evaluation = scenario.evaluate(succeeded({ fileOperations: [], artifacts: [{ kind: "artifact", artifactType: "code", content: goodHtml }] }));
    assert.equal(evaluation.status, "PARTIAL");
    assert.notEqual(evaluation.status, "PASS", "writing correct code into the wrong channel must never earn a coding PASS");
    assert.equal(evaluation.fileOperationValid, false);
    assert.match(evaluation.notes, /wrong structured output channel/i);
  });

  test("FAIL (not PARTIAL): zero fileOperations AND no recognizable code in artifacts either", () => {
    const evaluation = scenario.evaluate(succeeded({ fileOperations: [], artifacts: [{ kind: "artifact", artifactType: "code", content: "I could not complete this task." }] }));
    assert.equal(evaluation.status, "FAIL");
  });
});

describe("frontend-bug-fix evaluation (the class of bug gemma4 previously failed)", () => {
  const scenario = getBenchmarkScenario("frontend-bug-fix");
  const fixedHtml =
    '<!doctype html><html><body><h1>Hello, World!</h1><p id="message">Welcome.</p><button id="changeBtn">Click me</button><script src="script.js"></script></body></html>';

  test("PASS: correctly adds the missing <script> linkage and preserves the heading", () => {
    const evaluation = scenario.evaluate(
      succeeded({ fileOperations: [{ kind: "file-operation", action: "write", path: "index.html", content: fixedHtml }] }),
    );
    assert.equal(evaluation.status, "PASS");
    assert.equal(evaluation.defectDiagnosed, true);
  });

  test("FAIL: changes something but never adds the <script> tag — the actual reported defect", () => {
    const evaluation = scenario.evaluate(
      succeeded({
        fileOperations: [
          { kind: "file-operation", action: "write", path: "index.html", content: "<html><body><h1>Hello, World! (v2)</h1></body></html>" },
        ],
      }),
    );
    assert.equal(evaluation.status, "FAIL");
    assert.equal(evaluation.defectDiagnosed, false);
  });

  test("FAIL: no file operation at all", () => {
    const evaluation = scenario.evaluate(succeeded({ fileOperations: [] }));
    assert.equal(evaluation.status, "FAIL");
  });

  test("PARTIAL, never PASS: the fix was described/shown in an artifact but never emitted as a fileOperation (Part 8)", () => {
    const evaluation = scenario.evaluate(succeeded({ fileOperations: [], artifacts: [{ kind: "artifact", artifactType: "code", content: fixedHtml }] }));
    assert.equal(evaluation.status, "PARTIAL");
    assert.notEqual(evaluation.status, "PASS");
    assert.equal(evaluation.defectDiagnosed, false);
  });
});

describe("code-review evaluation", () => {
  const scenario = getBenchmarkScenario("code-review");

  test("PASS: names the exact typo", () => {
    const evaluation = scenario.evaluate(succeeded({ summary: 'The click handler references "outptu" instead of the real element id.' }));
    assert.equal(evaluation.status, "PASS");
    assert.equal(evaluation.defectDiagnosed, true);
  });

  test("PASS: describes the mismatch without quoting the exact string", () => {
    const evaluation = scenario.evaluate(succeeded({ summary: "The button click handler uses an incorrect id that does not match the message element." }));
    assert.equal(evaluation.status, "PASS");
  });

  test("FAIL: misses the deliberate bug entirely", () => {
    const evaluation = scenario.evaluate(succeeded({ summary: "The code looks fine overall." }));
    assert.equal(evaluation.status, "FAIL");
    assert.equal(evaluation.defectDiagnosed, false);
  });
});

describe("qa-interpretation evaluation", () => {
  const scenario = getBenchmarkScenario("qa-interpretation");

  test("PASS: relevant, actionable remediation guidance", () => {
    const evaluation = scenario.evaluate(
      succeeded({
        testResults: [{ kind: "test-result", status: "FAIL", summary: "Button click did not update the message." }],
        recommendedNextActions: ["Link script.js in index.html and verify the element id used in the click handler."],
      }),
    );
    assert.equal(evaluation.status, "PASS");
  });

  test("FAIL: no actionable guidance produced", () => {
    const evaluation = scenario.evaluate(succeeded({ testResults: [], recommendedNextActions: [] }));
    assert.equal(evaluation.status, "FAIL");
  });
});
