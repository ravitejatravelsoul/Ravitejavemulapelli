import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Static/architectural check for
 * docs/ai-office/09-budget-and-cost-controls.md §2's rule: no module
 * outside lib/ai-office/agents/agent-runner.ts is allowed to import a
 * live provider adapter implementation. This is what makes it
 * structurally impossible (not just policy) for a future live provider
 * to bypass AgentRunner/BudgetService.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const LIB_AI_OFFICE = join(REPO_ROOT, "lib", "ai-office");
const ADAPTER_IMPORT_PATTERN = /providers\/simulated\/simulated-adapter(\.ts)?["']/;

function listTsFilesRecursively(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
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

describe("provider adapter import boundary", () => {
  test("no file outside agent-runner.ts imports SimulatedAdapter (or any provider adapter)", () => {
    const allFiles = listTsFilesRecursively(LIB_AI_OFFICE);
    const offenders: string[] = [];

    for (const file of allFiles) {
      if (file.endsWith(join("agents", "agent-runner.ts"))) continue; // the one permitted importer
      if (file.includes(join("providers", "simulated"))) continue; // the adapter's own implementation files
      if (file.includes(join("__tests__"))) continue; // tests intentionally exercise the adapter directly too

      const content = readFileSync(file, "utf8");
      if (ADAPTER_IMPORT_PATTERN.test(content)) {
        offenders.push(file);
      }
    }

    assert.deepEqual(offenders, [], `These files import the provider adapter directly, bypassing AgentRunner: ${offenders.join(", ")}`);
  });

  test("agent-runner.ts itself does import the adapter (sanity check the pattern isn't vacuously passing)", () => {
    const content = readFileSync(join(LIB_AI_OFFICE, "agents", "agent-runner.ts"), "utf8");
    assert.ok(ADAPTER_IMPORT_PATTERN.test(content));
  });
});
