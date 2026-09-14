import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isOperationalFailureReason } from "../failure-classification.ts";

describe("isOperationalFailureReason", () => {
  test("recognizes Ollama's malformed-JSON failures as operational (pre-existing behavior)", () => {
    assert.equal(isOperationalFailureReason("Ollama's model output was not valid JSON."), true);
    assert.equal(isOperationalFailureReason("Ollama's HTTP response body was not valid JSON."), true);
  });

  test("real defect fixed — recognizes Claude's equivalent malformed-JSON failure as operational too", () => {
    // The exact real failure string recorded during the second AI Office
    // pilot (TaskFlow's backend-developer task) — this used to be
    // misclassified as semantic, consuming a real retry attempt and
    // preventing Office Engineer's auto-repair from ever applying to it.
    assert.equal(isOperationalFailureReason("Claude's model output was not valid JSON."), true);
    assert.equal(isOperationalFailureReason("Claude's HTTP response body was not valid JSON."), true);
  });

  test("generically recognizes any future provider's identical failure shape, not just hardcoded names", () => {
    assert.equal(isOperationalFailureReason("Gemini's model output was not valid JSON."), true);
  });

  test("recognizes every other existing operational pattern", () => {
    assert.equal(isOperationalFailureReason("Ollama request timed out after 120000ms (model \"gemma4:latest\")."), true);
    assert.equal(isOperationalFailureReason("Could not reach Ollama at http://127.0.0.1:11434."), true);
    assert.equal(isOperationalFailureReason("Ollama responded with HTTP 500."), true);
    assert.equal(isOperationalFailureReason("Claude's model output did not match the expected structured shape: missing 'summary'."), true);
    assert.equal(isOperationalFailureReason("Execution timed out after 300000ms."), true);
    assert.equal(isOperationalFailureReason("Operational: Claude request timed out after 120000ms (model \"claude-sonnet-5\")."), true);
  });

  test("never misclassifies a real semantic/content failure as operational", () => {
    assert.equal(isOperationalFailureReason('"index.html" does not exist in the project workspace — nothing to load.'), false);
    assert.equal(isOperationalFailureReason("Clicking the button did not change any visible text on the page."), false);
    assert.equal(isOperationalFailureReason("Claude request failed: 400 {\"type\":\"error\"...}"), false);
  });
});
