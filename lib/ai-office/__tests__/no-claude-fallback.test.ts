import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Controlled Claude LIVE pilot follow-up — this file's guarantee changed
 * from "no Claude client exists at all" (true through the local-only
 * phase) to "Claude exists, but only behind the same import boundary,
 * approval gate, and budget authorization every other provider-side
 * concern already goes through." A silent/uncontrolled fallback to
 * Claude — from routing, from LocalModelRouter, or from any file other
 * than agent-runner.ts importing the SDK directly — is still exactly as
 * unacceptable as it was before Claude was added.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const ADAPTER_IMPORT_PATTERN = /@anthropic-ai\/sdk|from ["']anthropic["']/i;

function listTsFilesRecursively(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFilesRecursively(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Claude import boundary — no uncontrolled/silent fallback", () => {
  test("only agent-runner.ts and the Claude adapter's own implementation file import the Anthropic SDK", () => {
    const libAiOffice = join(REPO_ROOT, "lib", "ai-office");
    const allFiles = listTsFilesRecursively(libAiOffice);
    const offenders: string[] = [];

    for (const file of allFiles) {
      if (file.endsWith(join("agents", "agent-runner.ts"))) continue; // the one permitted orchestration-level importer
      if (file.includes(join("providers", "claude"))) continue; // the adapter's own implementation files
      if (file.includes(join("__tests__"))) continue; // tests intentionally exercise/mock the adapter directly too

      const content = readFileSync(file, "utf8");
      if (ADAPTER_IMPORT_PATTERN.test(content)) offenders.push(file);
    }

    assert.deepEqual(offenders, [], `These files import the Anthropic SDK directly, bypassing agent-runner.ts: ${offenders.join(", ")}`);
  });

  test("no client component (\"use client\") ever imports the Anthropic SDK or reads an API key", () => {
    const appDir = join(REPO_ROOT, "app");
    const componentsDir = join(REPO_ROOT, "components");
    const offenders: string[] = [];

    for (const dir of [appDir, componentsDir]) {
      for (const file of listTsFilesRecursively(dir)) {
        const content = readFileSync(file, "utf8");
        const isClientComponent = /^["']use client["'];?/m.test(content);
        if (!isClientComponent) continue;
        if (ADAPTER_IMPORT_PATTERN.test(content) || /ANTHROPIC_API_KEY/.test(content)) offenders.push(file);
      }
    }

    assert.deepEqual(offenders, [], `These client components reference Claude/the API key: ${offenders.join(", ")}`);
  });

  test("LocalModelRouter's AUTO fallback only ever returns a model from the real detected availableModels list — never Claude, never a name it invented", async () => {
    const { LocalModelRouter } = await import("../agents/model-router.ts");
    const { createTestDb } = await import("../db/test-helpers.ts");
    const { getOwner } = await import("../domain/users.ts");
    const { createProjectWithIdea } = await import("../domain/projects.ts");

    process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
    process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, { title: "P", rawIdeaText: "Build a small tool.", ownerId: owner.id, provider: "ollama" });

    const availableModels = ["some-real-installed-model:latest"];
    const result = new LocalModelRouter(t.db).selectModel({ role: "frontend-developer", project, attemptNumber: 1, availableModels });
    assert.ok(availableModels.includes(result.model), "the router must never select a model outside the real detected list");
    assert.notEqual(result.model.toLowerCase(), "claude");

    t.close();
  });

  test("a LOCAL_ONLY project's provider routing never even considers Claude, regardless of local capability evidence", async () => {
    const { routeProvider } = await import("../agents/provider-router.ts");
    const { createTestDb } = await import("../db/test-helpers.ts");
    const { getOwner } = await import("../domain/users.ts");
    const { createProjectWithIdea } = await import("../domain/projects.ts");
    const { recordBenchmarkResult } = await import("../domain/model-routing.ts");

    process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
    process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const { project } = createProjectWithIdea(t.db, {
      title: "P",
      rawIdeaText: "Build a small tool.",
      ownerId: owner.id,
      provider: "ollama",
      aiPolicyMode: "LOCAL_ONLY",
    });
    // Even with real evidence saying CODING is unqualified everywhere locally...
    recordBenchmarkResult(t.db, { model: "gemma4:latest", scenarioId: "frontend-build", roleId: "frontend-developer", status: "FAIL", score: 10, latencyMs: 1000 });
    recordBenchmarkResult(t.db, { model: "gemma4:latest", scenarioId: "frontend-bug-fix", roleId: "frontend-developer", status: "FAIL", score: 10, latencyMs: 1000 });

    const decision = routeProvider(t.db, { role: "frontend-developer", project });
    assert.equal(decision.provider, "LOCAL", "LOCAL_ONLY must never route to Claude no matter what the evidence says");

    t.close();
  });
});
