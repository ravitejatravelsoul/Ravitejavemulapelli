import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateTaskGraph, type PlanTaskNode } from "../graph.ts";

function node(id: string, dependsOn: string[] = []): PlanTaskNode {
  return { id, roleId: "backend-developer", title: id, dependsOn };
}

describe("validateTaskGraph", () => {
  test("accepts a valid linear chain", () => {
    const result = validateTaskGraph([node("a"), node("b", ["a"]), node("c", ["b"])]);
    assert.deepEqual(result, { valid: true });
  });

  test("accepts a valid diamond (fan-out then fan-in)", () => {
    const result = validateTaskGraph([node("a"), node("b", ["a"]), node("c", ["a"]), node("d", ["b", "c"])]);
    assert.deepEqual(result, { valid: true });
  });

  test("accepts an empty plan", () => {
    assert.deepEqual(validateTaskGraph([]), { valid: true });
  });

  test("rejects a self-dependency", () => {
    const result = validateTaskGraph([node("a", ["a"])]);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /depends on itself/);
  });

  test("rejects a dependency on a task id absent from the plan", () => {
    const result = validateTaskGraph([node("a", ["ghost"])]);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /not present in the plan/);
  });

  test("rejects a two-node cycle", () => {
    const result = validateTaskGraph([node("a", ["b"]), node("b", ["a"])]);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /cycle/);
  });

  test("rejects a longer indirect cycle (a -> b -> c -> a)", () => {
    const result = validateTaskGraph([node("a", ["c"]), node("b", ["a"]), node("c", ["b"])]);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /cycle/);
  });

  test("rejects a duplicate task id", () => {
    const result = validateTaskGraph([node("a"), node("a")]);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /Duplicate/);
  });
});
