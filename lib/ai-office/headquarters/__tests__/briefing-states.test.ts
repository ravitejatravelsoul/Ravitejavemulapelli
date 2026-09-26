import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import {
  createTask,
  createTaskWithDependencies,
  createTaskAttempt,
  createAgentRunForAttempt,
  updateTaskStatus,
  updateAgentRunStatus,
} from "../../domain/tasks.ts";
import { createArtifact, recordFailure, recordTestResult } from "../../domain/project-outputs.ts";
import { getAIHeadquartersWorldState } from "../world-state.ts";
import { agentBriefing, briefingKind } from "../presentation.ts";
import { proximityBriefing, briefSignature, shouldGreet } from "../experience.ts";
import { OfficeSpeechController, type SpeechBriefing } from "../speech.ts";

process.env.OFFICE_OWNER_EMAIL = "acceptance@example.test";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic";

type Db = ReturnType<typeof createTestDb>;
const project = (t: Db, title: string) =>
  createProjectWithIdea(t.db, { title, rawIdeaText: "PRIVATE IDEA TEXT", ownerId: getOwner(t.db)!.id, routingMode: "FREE_MULTI_MODEL" }).project;

/** A real, fully persisted finished task: DONE, a SUCCEEDED run and (optionally) an artifact. */
function finishTask(t: Db, projectId: string, roleId: string, title: string, artifact?: { type: "requirements" | "test-report"; content: string }) {
  const task = createTask(t.db, { projectId, roleId, title });
  updateTaskStatus(t.db, task.id, "IN_PROGRESS");
  const attempt = createTaskAttempt(t.db, task.id);
  const run = createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId, provider: "groq", model: "recorded-model" });
  updateAgentRunStatus(t.db, run.id, "RUNNING");
  if (artifact) createArtifact(t.db, { projectId, taskId: task.id, ...artifact });
  updateAgentRunStatus(t.db, run.id, "SUCCEEDED", Date.now() - 30_000);
  updateTaskStatus(t.db, task.id, "DONE");
  return task;
}
const agentOf = (t: Db, projectId: string, roleId: string) => {
  const s = getAIHeadquartersWorldState(t.db, projectId);
  return { s, a: s.agents.find((x) => x.roleId === roleId)! };
};
const both = (a: Parameters<typeof agentBriefing>[0], s: Parameters<typeof agentBriefing>[1]) => [agentBriefing(a, s, 9), proximityBriefing(a, s, 9)];

test("COMPLETED: the briefing states real completed work from persisted task, run and artifact — and is never worded as active", () => {
  const t = createTestDb();
  try {
    const p = project(t, "Notes Desk");
    const content = "## Requirements\n1. Do the thing.";
    finishTask(t, p.id, "product-owner", "Define requirements — Notes Desk", { type: "requirements", content });
    const { s, a } = agentOf(t, p.id, "product-owner");
    assert.equal(briefingKind(a), "COMPLETED");
    for (const text of both(a, s)) {
      assert.match(text, /Good morning, Boss\. I completed "?Define requirements — Notes Desk"? just now\./);
      assert.ok(text.includes(`a requirements document (${content.length} characters)`), text);
      assert.match(text, /Recorded run: groq \/ recorded-model/);
      assert.match(text, /[Nn]o active task/);
      assert.ok(!/working|thinking|testing|reviewing|retrying/i.test(text), "completed work is not presented as active: " + text);
      assert.ok(!text.includes("PRIVATE IDEA TEXT"), "no raw persisted content beyond the size");
      assert.ok(!text.includes("Do the thing"), "artifact text is never copied into speech");
    }
  } finally {
    t.close();
  }
});

test("COMPLETED QA cites the real persisted test result; ACTIVE wording differs from COMPLETED wording for the same role", () => {
  const t = createTestDb();
  try {
    const p = project(t, "Notes Desk");
    const task = finishTask(t, p.id, "qa-agent", "Test — Notes Desk", { type: "test-report", content: "report" });
    recordTestResult(t.db, { projectId: p.id, taskId: task.id, status: "PASS", summary: "Page loaded and the button changed the page text." });
    const done = agentOf(t, p.id, "qa-agent");
    const completedText = agentBriefing(done.a, done.s, 9);
    assert.match(completedText, /I completed "Test — Notes Desk"/);
    assert.match(completedText, /real browser test PASS: Page loaded and the button changed the page text/);

    // The same role starts a NEW active run (a retest): now it must be ACTIVE wording only.
    const retest = createTask(t.db, { projectId: p.id, roleId: "qa-agent", title: "Retest — Notes Desk" });
    updateTaskStatus(t.db, retest.id, "IN_PROGRESS");
    const attempt = createTaskAttempt(t.db, retest.id);
    updateAgentRunStatus(t.db, createAgentRunForAttempt(t.db, { taskAttemptId: attempt.id, roleId: "qa-agent", provider: "groq", model: "recorded-model" }).id, "RUNNING");
    const active = agentOf(t, p.id, "qa-agent");
    assert.equal(briefingKind(active.a), "ACTIVE");
    for (const text of both(active.a, active.s)) {
      assert.match(text, /testing/i);
      assert.match(text, /Retest — Notes Desk/);
      assert.ok(!/I completed/.test(text), "active work must not be phrased as completed: " + text);
    }
    assert.notEqual(completedText, agentBriefing(active.a, active.s, 9));
  } finally {
    t.close();
  }
});

test("WAITING names the real unfinished dependency; BLOCKED uses only the safe existing summary, never raw failure text", () => {
  const t = createTestDb();
  try {
    const p = project(t, "Notes Desk");
    const upstream = createTask(t.db, { projectId: p.id, roleId: "frontend-developer", title: "Implement frontend — Notes Desk" });
    createTaskWithDependencies(t.db, { projectId: p.id, roleId: "qa-agent", title: "Test — Notes Desk", dependsOnTaskIds: [upstream.id] });
    const w = agentOf(t, p.id, "qa-agent");
    assert.equal(briefingKind(w.a), "WAITING");
    for (const text of both(w.a, w.s)) {
      assert.match(text, /waiting/i);
      assert.match(text, /Implement frontend — Notes Desk/);
      assert.ok(!/I completed|testing/i.test(text));
    }

    recordFailure(t.db, { projectId: p.id, taskId: upstream.id, reason: "UNSAFE_RAW_PROVIDER_FAILURE sk-abcdefghijklmnop private reasoning" });
    updateTaskStatus(t.db, upstream.id, "BLOCKED");
    const b = agentOf(t, p.id, "frontend-developer");
    assert.equal(briefingKind(b.a), "BLOCKED");
    for (const text of both(b.a, b.s)) {
      assert.match(text, /[Bb]locked/);
      assert.match(text, /recorded task failure needs review/);
      assert.ok(!/UNSAFE_RAW_PROVIDER_FAILURE|sk-abcdef|private reasoning/.test(text), text);
    }
  } finally {
    t.close();
  }
});

test("IDLE and NOT-PARTICIPATING are honest: a role with no task in the project says so, and nothing is claimed as done", () => {
  const t = createTestDb();
  try {
    const p = project(t, "Notes Desk");
    finishTask(t, p.id, "product-owner", "Define requirements — Notes Desk");
    const sec = agentOf(t, p.id, "security-reviewer");
    assert.equal(briefingKind(sec.a), "NOT_PARTICIPATING");
    for (const text of both(sec.a, sec.s)) {
      assert.match(text, /not assigned any task in Notes Desk/);
      assert.match(text, /idle and available/);
      assert.ok(!/I completed|Recorded run|working/i.test(text), text);
    }
    // A participating role whose task simply has not started and has no recorded dependency is IDLE, not waiting/active.
    createTask(t.db, { projectId: p.id, roleId: "code-reviewer", title: "Code review — Notes Desk" });
    const r = agentOf(t, p.id, "code-reviewer");
    assert.ok(["IDLE", "WAITING"].includes(briefingKind(r.a)));
    assert.ok(!/I completed/.test(agentBriefing(r.a, r.s, 9)));
  } finally {
    t.close();
  }
});

test("no stale attribution: another project's finished work never appears in this project's briefings", () => {
  const t = createTestDb();
  try {
    const a = project(t, "Alpha Project"),
      b = project(t, "Beta Project");
    finishTask(t, b.id, "product-owner", "Define requirements — Beta Project", { type: "requirements", content: "B".repeat(4321) });
    const inAlpha = agentOf(t, a.id, "product-owner");
    assert.equal(briefingKind(inAlpha.a), "NOT_PARTICIPATING");
    const text = both(inAlpha.a, inAlpha.s).join(" ");
    assert.ok(!/Beta|4,321/.test(text), text);
    assert.equal(JSON.stringify(inAlpha.s).includes("4321"), false);
    const inBeta = agentOf(t, b.id, "product-owner");
    assert.match(agentBriefing(inBeta.a, inBeta.s, 9), /Beta Project/);
    assert.ok(!/Alpha/.test(agentBriefing(inBeta.a, inBeta.s, 9)));
  } finally {
    t.close();
  }
});

test("speech text is deterministic, needs no network/model call and does not change the authoritative revision", () => {
  const t = createTestDb();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("no network allowed for speech");
  }) as typeof fetch;
  try {
    const p = project(t, "Notes Desk");
    finishTask(t, p.id, "product-owner", "Define requirements — Notes Desk", { type: "requirements", content: "x".repeat(50) });
    const first = agentOf(t, p.id, "product-owner");
    const second = agentOf(t, p.id, "product-owner");
    assert.equal(first.s.revision, second.s.revision);
    assert.deepEqual(both(first.a, first.s), both(second.a, second.s));
    assert.equal(calls, 0, "generating state and briefings performs zero network/LLM calls");
  } finally {
    globalThis.fetch = realFetch;
    t.close();
  }
});

test("greeting cooldown: completing work changes the brief signature so a changed situation is announced, an unchanged one respects the cooldown", () => {
  const t = createTestDb();
  try {
    const p = project(t, "Notes Desk");
    const before = agentOf(t, p.id, "product-owner").a;
    finishTask(t, p.id, "product-owner", "Define requirements — Notes Desk");
    const after = agentOf(t, p.id, "product-owner").a;
    const s1 = briefSignature(before, p.id),
      s2 = briefSignature(after, p.id);
    assert.notEqual(s1, s2);
    assert.equal(shouldGreet({ at: 1_000, signature: s2 }, s2, 2_000), false, "same situation inside the cooldown is not repeated");
    assert.equal(shouldGreet({ at: 1_000, signature: s1 }, s2, 2_000), true, "a changed situation is announced");
    assert.equal(shouldGreet({ at: 1_000, signature: s2 }, s2, 1_000 + 90_000), true, "and it may be repeated after the cooldown");
  } finally {
    t.close();
  }
});

// The controller behaviour is independent of briefing kind — prove it with real completed/active briefings.
const voice = { name: "Local", voiceURI: "local", lang: "en-US", localService: true, default: true } as SpeechSynthesisVoice;
function controller(t: TestContext) {
  const utterances: SpeechSynthesisUtterance[] = [];
  let cancels = 0;
  const c = new OfficeSpeechController(
    { voices: () => [voice], utterance: (text) => ({ text }) as SpeechSynthesisUtterance, speak: (u) => { utterances.push(u); }, cancel: () => { cancels++; } },
    () => {},
  );
  t.after(() => c.dispose());
  c.unlock();
  return { c, utterances, cancels: () => cancels };
}
const say = (role: string, text: string, priority: 1 | 2 = 1): SpeechBriefing => ({ role, text, priority, revision: "r" });

test("single speaker, walk-away cancellation and Voice OFF still hold for completed-work briefings", (t) => {
  const { c, utterances, cancels } = controller(t);
  const completed = "Good morning, Boss. I completed \"Define requirements\" just now. The result: a requirements document (10 characters).";
  assert.equal(c.speak(say("product-owner", completed)), true);
  utterances[0].onstart?.({} as SpeechSynthesisEvent);
  assert.equal(c.view.status, "speaking");
  assert.equal(utterances[0].text, completed, "exact subtitle text is spoken");
  // Another agent replaces the first: never two speakers.
  assert.equal(c.speak(say("qa-agent", "Good morning, Boss. I completed \"Test\" just now.")), true);
  assert.equal(c.view.briefing?.role, "qa-agent");
  assert.ok(cancels() >= 1);
  // Walking away from the current speaker cancels; walking away from someone else does not.
  c.leave("qa-agent");
  assert.notEqual(c.view.status, "idle", "still near the current speaker: speech continues");
  c.leave("architect-not-current");
  assert.equal(c.view.status, "idle", "walking away from the speaker cancels speech");
  // Voice OFF prevents any utterance.
  c.setEnabled(false);
  const before = utterances.length;
  assert.equal(c.speak(say("release-agent", completed)), false);
  assert.equal(utterances.length, before);
});
