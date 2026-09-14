import test from "node:test";
import assert from "node:assert/strict";
import { signPreviewToken, verifyPreviewToken } from "./preview-token.ts";

/**
 * Mirrors token.test.ts's coverage (missing/weak secret fails closed,
 * malformed token fails closed) plus the one property specific to this
 * module: a token is only ever valid for the exact project it was
 * signed for — see app/office/preview/[projectId]/[...path]/route.ts's
 * docblock for why this token exists at all (a sandboxed opaque-origin
 * iframe never sends cookies for any of its own requests).
 */

const ORIGINAL_SECRET = process.env.OFFICE_SESSION_SECRET;

test.afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.OFFICE_SESSION_SECRET;
  } else {
    process.env.OFFICE_SESSION_SECRET = ORIGINAL_SECRET;
  }
});

test("signPreviewToken returns null when OFFICE_SESSION_SECRET is missing", async () => {
  delete process.env.OFFICE_SESSION_SECRET;
  const token = await signPreviewToken("project-1");
  assert.equal(token, null);
});

test("signPreviewToken returns null when OFFICE_SESSION_SECRET is shorter than 32 bytes", async () => {
  process.env.OFFICE_SESSION_SECRET = "short-secret";
  const token = await signPreviewToken("project-1");
  assert.equal(token, null);
});

test("signPreviewToken succeeds and verifyPreviewToken round-trips for the exact same project id", async () => {
  process.env.OFFICE_SESSION_SECRET = "a".repeat(32);
  const token = await signPreviewToken("project-1");
  assert.ok(typeof token === "string" && token.length > 0);

  assert.equal(await verifyPreviewToken(token as string, "project-1"), true);
});

test("a token minted for one project is rejected for a different project", async () => {
  process.env.OFFICE_SESSION_SECRET = "b".repeat(32);
  const token = await signPreviewToken("project-1");
  assert.ok(token);

  assert.equal(await verifyPreviewToken(token as string, "project-2"), false);
});

test("verifyPreviewToken fails closed if the secret becomes weak after a token was already signed", async () => {
  process.env.OFFICE_SESSION_SECRET = "c".repeat(32);
  const token = await signPreviewToken("project-1");
  assert.ok(token);

  process.env.OFFICE_SESSION_SECRET = "too-short";
  assert.equal(await verifyPreviewToken(token as string, "project-1"), false);
});

test("verifyPreviewToken returns false for a malformed token even with a valid secret", async () => {
  process.env.OFFICE_SESSION_SECRET = "d".repeat(32);
  assert.equal(await verifyPreviewToken("not-a-real-jwt", "project-1"), false);
});
