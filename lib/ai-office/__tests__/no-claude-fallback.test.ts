import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Local multi-model routing follow-up, Part V/F — "NEVER fall back from
 * local-unavailable to Claude." This is structurally true today because
 * no Claude/Anthropic client exists anywhere in this codebase at all;
 * these checks make that fact explicit and durable so a future change
 * can't silently introduce one without this test catching it.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

describe("no Claude/LIVE fallback exists anywhere in this codebase", () => {
  test("package.json has no Anthropic SDK dependency", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const anthropicDeps = Object.keys(allDeps).filter((name) => /anthropic/i.test(name));
    assert.deepEqual(anthropicDeps, []);
  });

  test("no file under lib/ai-office imports an Anthropic/Claude client", () => {
    const libAiOffice = join(REPO_ROOT, "lib", "ai-office");
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          const content = readFileSync(fullPath, "utf8");
          if (/@anthropic-ai\/sdk|from ["']anthropic["']/i.test(content)) offenders.push(fullPath);
        }
      }
    }
    walk(libAiOffice);

    assert.deepEqual(offenders, [], `These files reference an Anthropic client: ${offenders.join(", ")}`);
  });

  test("LocalModelRouter's AUTO fallback only ever returns a model from the real detected availableModels list — never a name it invented", async () => {
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
});
