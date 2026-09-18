process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDb } from "../test-helpers.ts";
import { createProjectWithIdea, getProject } from "../../domain/projects.ts";
import { getOwner } from "../../domain/users.ts";

test("migration preserves standard projects and upgrades legacy free projects without changing providers", () => {
  const t = createTestDb();
  try {
    const ownerId = getOwner(t.db)!.id;
    const standard = createProjectWithIdea(t.db, { title: "Standard", rawIdeaText: "Old standard project", ownerId, provider: "ollama" }).project;
    const legacy = createProjectWithIdea(t.db, { title: "Legacy", rawIdeaText: "Old free project", ownerId, provider: "ollama", freeModelOrchestration: true }).project;
    t.db.exec("ALTER TABLE projects DROP COLUMN routingMode");
    t.db.exec(readFileSync(new URL("../migrations/016-separate-routing-mode.sql", import.meta.url), "utf8"));
    assert.equal(getProject(t.db, standard.id)!.routingMode, "STANDARD");
    assert.equal(getProject(t.db, legacy.id)!.routingMode, "FREE_MULTI_MODEL");
    assert.equal(getProject(t.db, legacy.id)!.provider, "ollama");
    const independent = createProjectWithIdea(t.db, { title: "Independent", rawIdeaText: "Free with no Ollama dependency", ownerId, routingMode: "FREE_MULTI_MODEL" }).project;
    assert.equal(independent.provider, "simulated");
    assert.equal(independent.routingMode, "FREE_MULTI_MODEL");
  } finally { t.close(); }
});
