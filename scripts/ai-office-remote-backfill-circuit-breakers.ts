import "server-only";
import { hydrateEphemeralDb, readOfficeState, remoteClientFromEnv } from "../lib/ai-office/remote/remote-state-store.ts";
import { acquireModelCatalog, commitModelCatalog } from "../lib/ai-office/remote/model-catalog.ts";
import { backfillStuckCircuitBreakers } from "../lib/ai-office/domain/model-registry.ts";

/**
 * Owner-operated, one-time-per-incident healing tool — explicit and
 * auditable, never run automatically. See
 * backfillStuckCircuitBreakers()'s own docblock for the exact gap this
 * closes: the circuit breaker added for Priority 0 #4 only ever sets a
 * cooldown INSIDE recordModelOutcome, so a model already stuck at
 * recentFailureCount>=3 with no cooldown from BEFORE that fix existed
 * can never be selected again — meaning recordModelOutcome never runs
 * for it again, so it never retroactively heals on its own. This
 * applies the exact same bounded, owner-authorized formula once,
 * directly, to the real shared catalog.
 *
 * Uses the same acquire/commit lease flow the remote worker itself uses
 * for model health, so this can never race a live worker cycle.
 *
 * Usage (from this repo's root, with Remote Mode env vars set):
 *   node --conditions=react-server scripts/ai-office-remote-backfill-circuit-breakers.ts
 */

function log(message: string): void {
  console.log(`[backfill-circuit-breakers] ${message}`);
}

async function main(): Promise<void> {
  const config = remoteClientFromEnv();
  const { state: office } = await readOfficeState(config);
  const held = await acquireModelCatalog(config);
  const db = hydrateEphemeralDb(office, null, held.catalog);

  try {
    const applied = backfillStuckCircuitBreakers(db);
    if (applied.length === 0) {
      log("no model is currently stuck in a pre-existing, no-cooldown lockout — nothing to backfill.");
    } else {
      for (const a of applied) {
        log(`${a.provider}:${a.modelId} — recentFailureCount ${a.recentFailureCount}, recovery probe eligible at ${new Date(a.rateLimitedUntil).toISOString()}`);
      }
      log(`backfilled ${applied.length} model(s).`);
    }
    await commitModelCatalog(config, held, db);
    log("catalog committed and lease released.");
  } catch (error) {
    // The lease is only ever released by a successful commitModelCatalog —
    // on any failure here it's deliberately left held for the owner to
    // inspect (see acquireModelCatalog's own "no automatic lease stealing"
    // policy), rather than silently discarding a possibly-real failure.
    log(`FAILED — the catalog lease is still held; inspect state/model-catalog.json before retrying. ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("[backfill-circuit-breakers] fatal error:", error);
  process.exitCode = 1;
});
