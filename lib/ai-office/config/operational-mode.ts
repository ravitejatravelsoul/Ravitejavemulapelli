import "server-only";

/**
 * Production-safety guard for Teja's AI Office V1's limited production
 * release. The approved V1 architecture keeps the private, operational
 * AI Office (SQLite + local workspace filesystem + the runner) LOCAL
 * ONLY — `npm run office:dev` on a real, persistent machine — while the
 * public portfolio and the public `/ai-office` showcase deploy to Vercel.
 *
 * Without this guard, an owner who reaches the private `/office`
 * workspace on a production deployment with no durable hosting
 * configured (Vercel's serverless filesystem, specifically) could create
 * real projects, approve real paid Claude spend, and build real
 * operational/budget history that silently evaporates on the next cold
 * start or a different serverless instance — actively dangerous for a
 * budget ledger in particular, not just an inconvenience.
 *
 * `AI_OFFICE_OPERATIONAL_MODE` is the explicit override this decision
 * calls for (deliberately not hostname/platform detection, which is
 * fragile and easy to spoof or misjudge):
 *   - "enabled"  — always fully operational, regardless of NODE_ENV. Set
 *     this once real durable hosting exists for the private office (see
 *     the V1 persistence decision's Phase A-E).
 *   - "disabled" — always read-only/blocked, regardless of NODE_ENV.
 *   - unset      — the safe default: fully operational outside a
 *     production build (local dev, tests, CI), disabled inside one. This
 *     means Vercel's production deployment is safe-by-default the
 *     moment it exists, with no separate step required to lock it down.
 */
export function isAiOfficeOperationalModeEnabled(): boolean {
  const override = process.env.AI_OFFICE_OPERATIONAL_MODE;
  if (override === "enabled") return true;
  if (override === "disabled") return false;
  return process.env.NODE_ENV !== "production";
}

/** Shown to the owner wherever a blocked action would otherwise have run — never a bare "no" with no explanation. */
export const OPERATIONAL_MODE_DISABLED_MESSAGE =
  "Production operations are disabled for this deployment. Teja's AI Office V1 runs its private, operational workspace locally only (npm run office:dev) until durable production hosting is configured — viewing stays available, but creating projects, resuming execution, or approving paid work is turned off here.";
