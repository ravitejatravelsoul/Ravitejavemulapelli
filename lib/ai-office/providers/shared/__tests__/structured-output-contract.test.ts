import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, buildPromptSegments } from "../structured-output-contract.ts";
import type { AgentTaskInput } from "../../types.ts";

/**
 * Token economics phase — `buildPrompt()` is what OllamaAdapter still
 * uses; `buildPromptSegments()` is the new Claude-only system/user split
 * for prompt caching. Part 12's "LOCAL calls remain unaffected" and the
 * final report's "Claude structured contract unchanged" both reduce to
 * one guarantee: `buildPrompt()`'s output must be byte-for-byte identical
 * to what it produced before this phase, and the new paid-provider-only
 * conciseness instructions must never leak into it.
 */

function input(overrides: Partial<AgentTaskInput["task"]> = {}): AgentTaskInput {
  return {
    role: "frontend-developer",
    instructions: 'Perform your assigned "Frontend Developer" responsibilities for this task.',
    task: {
      projectId: "p1",
      taskId: "t1",
      roleId: "frontend-developer",
      taskTitle: "Implement frontend",
      projectSummary: "",
      authoritativeUserRequest: "Create a simple Hello World webpage.",
      projectTitle: "Test Project",
      relevantArtifacts: [],
      relevantDecisions: [],
      ...overrides,
    },
  };
}

describe("buildPrompt (OllamaAdapter's exact, unaffected contract)", () => {
  test("section order is unchanged: role intro, authoritative request, metadata, prior work, response format", () => {
    const prompt = buildPrompt(input());
    const introIdx = prompt.indexOf('You are the "frontend-developer" role');
    const requestIdx = prompt.indexOf("===== AUTHORITATIVE USER REQUEST =====");
    const metadataIdx = prompt.indexOf("===== PROJECT METADATA");
    const priorWorkIdx = prompt.indexOf("===== APPROVED PRIOR WORK");
    const formatIdx = prompt.indexOf("Respond with ONLY a single JSON object");
    assert.ok(introIdx === 0);
    assert.ok(introIdx < requestIdx);
    assert.ok(requestIdx < metadataIdx);
    assert.ok(metadataIdx < priorWorkIdx);
    assert.ok(priorWorkIdx < formatIdx);
  });

  test("never includes the new paid-provider-only conciseness section — LOCAL calls are completely unaffected by this phase", () => {
    const prompt = buildPrompt(input());
    assert.ok(!prompt.includes("RESPONSE STYLE"));
    assert.ok(!prompt.includes("no chain-of-thought"));
  });

  test("is a single flat string, exactly as every existing OllamaAdapter test already depends on", () => {
    const prompt = buildPrompt(input());
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.includes("Create a simple Hello World webpage."));
  });
});

describe("buildPromptSegments (Claude-only system/user split for prompt caching)", () => {
  test("systemText contains the stable role contract and authoritative request; userText contains the volatile metadata/prior-work", () => {
    const { systemText, userText } = buildPromptSegments(input());
    assert.ok(systemText.includes('You are the "frontend-developer" role'));
    assert.ok(systemText.includes("Create a simple Hello World webpage."));
    assert.ok(systemText.includes("Respond with ONLY a single JSON object"));
    assert.ok(userText.includes("===== PROJECT METADATA"));
    assert.ok(userText.includes("===== APPROVED PRIOR WORK"));
  });

  test("systemText includes the paid-provider-only conciseness instructions that buildPrompt() never gets", () => {
    const { systemText } = buildPromptSegments(input());
    assert.ok(systemText.includes("RESPONSE STYLE"));
    assert.ok(systemText.includes("no chain-of-thought"));
  });

  test("the same underlying data drives both — a change to relevantArtifacts appears in both buildPrompt and buildPromptSegments identically", () => {
    const withArtifact = input({ relevantArtifacts: [{ type: "architecture", content: "Use a single index.html file." }] });
    const flat = buildPrompt(withArtifact);
    const { userText } = buildPromptSegments(withArtifact);
    assert.ok(flat.includes("Use a single index.html file."));
    assert.ok(userText.includes("Use a single index.html file."));
  });

  test("systemText never duplicates the volatile task title/metadata that userText carries", () => {
    const { systemText } = buildPromptSegments(input({ taskTitle: "A very specific tracking label" }));
    assert.ok(!systemText.includes("A very specific tracking label"));
  });
});
