import test from "node:test";
import assert from "node:assert/strict";
// Explicit ".ts" extension — required for plain Node ESM resolution (this
// file is run directly by `node --test`, not bundled by Next.js, so the
// extensionless `bundler`-style resolution the rest of the app uses via
// tsconfig doesn't apply here).
import { signSessionToken, verifySessionToken } from "./token.ts";

/**
 * Node's built-in test runner (`node:test`) — no new dependency, per the
 * dependency policy in docs/ai-office/00-master-plan.md. Run with:
 *   npm run test:ai-office
 * (`--conditions=react-server` is required so the `server-only` import in
 * token.ts resolves to its no-op build instead of throwing — that's how
 * Next.js's own server compiler resolves it; plain `node` needs the same
 * condition passed explicitly. See package.json.)
 *
 * Covers docs/ai-office/08-security-plan.md §2's session-secret strength
 * requirement: missing, too-short, and valid secrets, plus verification
 * failing closed independently of signing.
 */

const ORIGINAL_SECRET = process.env.OFFICE_SESSION_SECRET;

test.afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.OFFICE_SESSION_SECRET;
  } else {
    process.env.OFFICE_SESSION_SECRET = ORIGINAL_SECRET;
  }
});

test("signSessionToken returns null when OFFICE_SESSION_SECRET is missing", async () => {
  delete process.env.OFFICE_SESSION_SECRET;
  const token = await signSessionToken({ userId: "owner@example.com" }, "7d");
  assert.equal(token, null);
});

test("signSessionToken returns null when OFFICE_SESSION_SECRET is shorter than 32 bytes", async () => {
  process.env.OFFICE_SESSION_SECRET = "short-secret"; // 12 bytes
  const token = await signSessionToken({ userId: "owner@example.com" }, "7d");
  assert.equal(token, null);
});

test("signSessionToken succeeds and verifySessionToken round-trips when the secret is exactly 32 bytes", async () => {
  process.env.OFFICE_SESSION_SECRET = "a".repeat(32);
  const token = await signSessionToken({ userId: "owner@example.com" }, "7d");
  assert.ok(typeof token === "string" && token.length > 0);

  const payload = await verifySessionToken(token as string);
  assert.deepEqual(payload, { userId: "owner@example.com" });
});

test("verifySessionToken fails closed if the secret becomes weak after a token was already signed", async () => {
  process.env.OFFICE_SESSION_SECRET = "b".repeat(32);
  const token = await signSessionToken({ userId: "owner@example.com" }, "7d");
  assert.ok(token);

  process.env.OFFICE_SESSION_SECRET = "too-short";
  const payload = await verifySessionToken(token as string);
  assert.equal(payload, null);
});

test("verifySessionToken returns null for a malformed token even with a valid secret", async () => {
  process.env.OFFICE_SESSION_SECRET = "c".repeat(32);
  const payload = await verifySessionToken("not-a-real-jwt");
  assert.equal(payload, null);
});
