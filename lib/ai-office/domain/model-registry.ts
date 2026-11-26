import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { TaskCapability } from "../agents/free-model-capabilities.ts";

/**
 * Persistence for the free multi-model orchestration phase (migration
 * 015) — three independent concerns, matching the same "one file per
 * small, independent repository" convention as domain/model-routing.ts:
 *   1. `model_registry` — one row per (provider, modelId) the office
 *      knows about, with live health/rate-limit/benchmark/success-rate
 *      state the free-model router scores against.
 *   2. `provider_configs` — owner-controllable provider-level
 *      enable/disable, independent of per-model enable/disable.
 *   3. `model_routing_decisions` — full audit trail of every real
 *      free-model routing decision, for the Model Control Center's
 *      routing-history view.
 */

export type ModelHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";

export interface ModelRegistryRow {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  /** Catalog eligibility flag, not independent proof of account billing. See getFreeEligibility. */
  freeTier: 0 | 1;
  enabled: 0 | 1;
  capabilities: string; // JSON array of TaskCapability
  contextWindow: number | null;
  structuredOutput: 0 | 1;
  health: ModelHealth;
  rateLimitedUntil: number | null;
  recentFailureCount: number;
  benchmarkScore: number | null;
  avgLatencyMs: number | null;
  lastCheckedAt: number | null;
  lastUsedAt: number | null;
  tasksCompleted: number;
  tasksFailed: number;
  qualified: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface ModelRegistrySeedEntry {
  provider: string;
  modelId: string;
  displayName: string;
  capabilities: readonly TaskCapability[];
  contextWindow?: number | null;
  structuredOutput?: boolean;
  freeTier?: boolean;
}

function registryId(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/** Insert-or-refresh-metadata upsert — never touches live state (health/rateLimitedUntil/benchmarkScore/tasksCompleted/etc.) on an existing row, since those are only ever updated by recordModelHealthCheck/recordModelOutcome/setModelBenchmarkScore. Safe to call on every registry sync (model-catalog-sync.ts) without resetting a model's real track record. */
export function upsertModelRegistryEntry(db: DatabaseSync, entry: ModelRegistrySeedEntry): ModelRegistryRow {
  const id = registryId(entry.provider, entry.modelId);
  const now = Date.now();
  const existing = db.prepare("SELECT id FROM model_registry WHERE id = ?").get(id) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE model_registry SET displayName = ?, capabilities = ?, contextWindow = ?, structuredOutput = ?, freeTier = ?, updatedAt = ? WHERE id = ?`,
    ).run(
      entry.displayName,
      JSON.stringify(entry.capabilities),
      entry.contextWindow ?? null,
      entry.structuredOutput ? 1 : 0,
      entry.freeTier === false || !["ollama", "groq", "gemini", "openrouter"].includes(entry.provider) ? 0 : 1,
      now,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO model_registry
        (id, provider, modelId, displayName, freeTier, enabled, capabilities, contextWindow, structuredOutput, health, recentFailureCount, tasksCompleted, tasksFailed, qualified, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'UNKNOWN', 0, 0, 0, 0, ?, ?)`,
    ).run(
      id,
      entry.provider,
      entry.modelId,
      entry.displayName,
      entry.freeTier === false || !["ollama", "groq", "gemini", "openrouter"].includes(entry.provider) ? 0 : 1,
      JSON.stringify(entry.capabilities),
      entry.contextWindow ?? null,
      entry.structuredOutput ? 1 : 0,
      now,
      now,
    );
  }
  return getModelRegistryEntry(db, entry.provider, entry.modelId)!;
}

export function getModelRegistryEntry(db: DatabaseSync, provider: string, modelId: string): ModelRegistryRow | undefined {
  return db.prepare("SELECT * FROM model_registry WHERE id = ?").get(registryId(provider, modelId)) as unknown as ModelRegistryRow | undefined;
}

export function listModelRegistryEntries(db: DatabaseSync, filters: { provider?: string; enabledOnly?: boolean } = {}): ModelRegistryRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.provider) {
    clauses.push("provider = ?");
    params.push(filters.provider);
  }
  if (filters.enabledOnly) {
    clauses.push("enabled = 1");
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM model_registry ${where} ORDER BY provider, modelId`).all(...params) as unknown as ModelRegistryRow[];
}

/** Owner-only write path (enforced by the calling Server Action) — per-model enable/disable, independent of the model's provider-level `provider_configs` row. */
export function setModelEnabled(db: DatabaseSync, provider: string, modelId: string, enabled: boolean): void {
  db.prepare("UPDATE model_registry SET enabled = ?, updatedAt = ? WHERE id = ?").run(enabled ? 1 : 0, Date.now(), registryId(provider, modelId));
}

/** A simple exponential moving average (0.3 weight on the newest sample) — smooths transient spikes without needing to store a rolling window. */
function ema(previous: number | null, sample: number, weight = 0.3): number {
  return previous === null ? sample : previous * (1 - weight) + sample * weight;
}

export interface RecordModelHealthCheckInput {
  health: ModelHealth;
  latencyMs?: number;
}

/** Called by model-catalog-sync.ts's periodic/owner-triggered health probe — a lightweight liveness signal, separate from `recordModelOutcome` (real task usage). Never throws on a model row that doesn't exist yet (a no-op) — the sync path that discovers a model always upserts it first. */
export function recordModelHealthCheck(db: DatabaseSync, provider: string, modelId: string, input: RecordModelHealthCheckInput): void {
  const row = getModelRegistryEntry(db, provider, modelId);
  if (!row) return;
  const avgLatencyMs = input.latencyMs !== undefined ? ema(row.avgLatencyMs, input.latencyMs) : row.avgLatencyMs;
  db.prepare("UPDATE model_registry SET health = ?, avgLatencyMs = ?, lastCheckedAt = ?, updatedAt = ? WHERE id = ?").run(
    input.health,
    avgLatencyMs,
    Date.now(),
    Date.now(),
    registryId(provider, modelId),
  );
}

export interface RecordModelOutcomeInput {
  /** Conversation probes/answers share health, but are not completed project tasks. */
  purpose?: "conversation";
  succeeded: boolean;
  latencyMs?: number;
  /** Set only when this specific failure was a rate-limit (HTTP 429) — marks the model UNAVAILABLE until `rateLimitedUntil` so the router stops repeatedly retrying it (per the brief's "if a configured free model disappears/becomes unavailable: mark unhealthy, do not repeatedly retry it"). */
  rateLimitedForMs?: number;
  /** HTTP 401/403/404/410 or an equivalent authentication/configuration problem — see agent-runner.ts's call site. Never auto-recovered by time: an invalid or revoked credential does not fix itself by waiting, so this stays UNAVAILABLE with no `rateLimitedUntil` until an owner corrects the actual configuration and a fresh real call succeeds. Distinct from the bounded circuit-breaker cooldown below, which is only ever for failures that a transient condition clearing could plausibly resolve. */
  unavailable?: boolean;
}

/**
 * Circuit-breaker cooldown for the three-consecutive-failure gate — real
 * incident (production, 2026-11-26): before this existed, three
 * consecutive GENUINE operational failures (never a generated-code
 * defect — see agent-runner.ts's `isOfficeLevelRejection`, which keeps
 * those out of `recentFailureCount` entirely) left a model permanently
 * UNAVAILABLE with no path back whatsoever, blocking every unrelated
 * project's ability to even create a new FREE_MULTI_MODEL task. The
 * owner has explicitly authorized controlled automatic recovery here.
 *
 * Reuses the existing `rateLimitedUntil` field's exact semantics (a
 * timestamp before which the router must not select this model) rather
 * than adding new schema — `scoreModel`'s existing
 * `row.rateLimitedUntil > now` exclusion already treats "unavailable
 * with an expired cooldown" as eligible again, so this only needed a
 * cooldown to actually be set for this failure class too.
 *
 * Exponential backoff, explicitly bounded (never unlimited retries):
 * the first trip (recentFailureCount reaching 3) gets a 15-minute
 * cooldown; each further failed recovery probe doubles it, capped at 4
 * hours. After `MAX_AUTO_RECOVERY_RECENT_FAILURES` total consecutive
 * failures, no further cooldown is set at all — the model stays
 * UNAVAILABLE indefinitely, same as before this change, requiring
 * explicit owner action. A single real success at any point resets
 * `recentFailureCount` to 0 and health to HEALTHY immediately (the
 * existing, unchanged line below) — the circuit fully closes.
 */
const CIRCUIT_BREAKER_BASE_COOLDOWN_MS = 15 * 60_000;
const CIRCUIT_BREAKER_MAX_COOLDOWN_MS = 4 * 60 * 60_000;
const MAX_AUTO_RECOVERY_RECENT_FAILURES = 7;

function circuitBreakerCooldownMs(recentFailureCount: number): number | null {
  if (recentFailureCount < 3 || recentFailureCount > MAX_AUTO_RECOVERY_RECENT_FAILURES) return null;
  return Math.min(CIRCUIT_BREAKER_BASE_COOLDOWN_MS * 2 ** (recentFailureCount - 3), CIRCUIT_BREAKER_MAX_COOLDOWN_MS);
}

/** Called once per real (non-benchmark) free-model task execution — this is what the router's scorer's `recentFailureCount`/success-rate/`avgLatencyMs`/health fields actually track over time. A no-op if the model row doesn't exist (should not happen — the router only ever selects rows already in the registry). */
export function recordModelOutcome(db: DatabaseSync, provider: string, modelId: string, input: RecordModelOutcomeInput): void {
  const row = getModelRegistryEntry(db, provider, modelId);
  if (!row) return;
  const now = Date.now();
  const avgLatencyMs = input.latencyMs !== undefined ? ema(row.avgLatencyMs, input.latencyMs) : row.avgLatencyMs;
  const tasksCompleted = row.tasksCompleted + (input.purpose !== "conversation" && input.succeeded ? 1 : 0);
  const tasksFailed = row.tasksFailed + (input.purpose !== "conversation" && !input.succeeded ? 1 : 0);
  const recentFailureCount = input.succeeded ? 0 : row.recentFailureCount + 1;
  const circuitBreakerCooldown = !input.succeeded && !input.unavailable && input.rateLimitedForMs === undefined ? circuitBreakerCooldownMs(recentFailureCount) : null;
  const rateLimitedUntil =
    input.rateLimitedForMs !== undefined
      ? now + input.rateLimitedForMs
      : input.succeeded
        ? null
        : circuitBreakerCooldown !== null
          ? now + circuitBreakerCooldown
          : row.rateLimitedUntil;
  // Authentication/configuration failures and rate limits mark UNAVAILABLE
  // immediately regardless of count (see each field's own docblock); three
  // consecutive genuine operational failures also go UNAVAILABLE, but now
  // with a real, bounded, exponentially-backing-off path back via
  // `rateLimitedUntil` instead of none at all.
  const health: ModelHealth = input.unavailable || input.rateLimitedForMs !== undefined ? "UNAVAILABLE" : recentFailureCount >= 3 ? "UNAVAILABLE" : input.succeeded ? "HEALTHY" : row.health;

  db.prepare(
    `UPDATE model_registry
     SET tasksCompleted = ?, tasksFailed = ?, recentFailureCount = ?, avgLatencyMs = ?, rateLimitedUntil = ?, health = ?, lastUsedAt = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(tasksCompleted, tasksFailed, recentFailureCount, avgLatencyMs, rateLimitedUntil, health, now, now, registryId(provider, modelId));
}

/** Applied by the (reused) benchmark system once it evaluates a free-provider model — see routing-recommendation.ts's per-capability aggregation, generalized in this phase to also score `model_registry` entries. `qualified` mirrors the existing `MIN_QUALIFYING_SUCCESS_RATE` threshold from domain/model-routing.ts. */
export function setModelBenchmarkScore(db: DatabaseSync, provider: string, modelId: string, input: { score: number; qualified: boolean }): void {
  db.prepare("UPDATE model_registry SET benchmarkScore = ?, qualified = ?, updatedAt = ? WHERE id = ?").run(
    input.score,
    input.qualified ? 1 : 0,
    Date.now(),
    registryId(provider, modelId),
  );
}

// ---- provider_configs -------------------------------------------------

/** No row for a provider means "enabled" — the default state a provider starts in once it's configured (has credentials) and its catalog has been synced at least once; only an explicit owner action creates a `provider_configs` row. */
export function isProviderEnabled(db: DatabaseSync, provider: string): boolean {
  const row = db.prepare("SELECT enabled FROM provider_configs WHERE provider = ?").get(provider) as { enabled: 0 | 1 } | undefined;
  return row ? row.enabled === 1 : true;
}

/** Owner-only write path (enforced by the calling Server Action). */
export function setProviderEnabled(db: DatabaseSync, provider: string, enabled: boolean): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO provider_configs (provider, enabled, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT (provider) DO UPDATE SET enabled = excluded.enabled, updatedAt = excluded.updatedAt`,
  ).run(provider, enabled ? 1 : 0, now);
}

export interface ProviderConfigRow {
  provider: string;
  enabled: 0 | 1;
  updatedAt: number;
}

export function listProviderConfigs(db: DatabaseSync): ProviderConfigRow[] {
  return db.prepare("SELECT * FROM provider_configs ORDER BY provider").all() as unknown as ProviderConfigRow[];
}

/** A plain non-component utility (not the page's render body) so `Date.now()` here is never flagged by the React Server Component purity lint rule — the Model Control Center UI's only caller. */
export function isCurrentlyRateLimited(rateLimitedUntil: number | null): boolean {
  return rateLimitedUntil != null && rateLimitedUntil > Date.now();
}

/**
 * A human-readable explanation for an UNAVAILABLE model's row in the
 * Model Control Center — `null` whenever the model isn't UNAVAILABLE.
 * Owner-facing follow-up to the circuit-breaker cooldown: before this,
 * every UNAVAILABLE reason looked identical ("UNAVAILABLE", no further
 * detail), even though a cooldown-pending model, a bounded-auto-recovery-
 * exhausted model and a credential/configuration problem all need
 * completely different owner responses (wait, consider resyncing
 * evidence, or fix the actual configuration). Always called server-side
 * (a plain non-component utility, matching `isCurrentlyRateLimited`'s own
 * docblock) so `Date.now()` is never evaluated inside a client
 * component's render.
 */
export function getUnavailableExplanation(row: Pick<ModelRegistryRow, "health" | "rateLimitedUntil" | "recentFailureCount">): string | null {
  if (row.health !== "UNAVAILABLE") return null;
  if (row.rateLimitedUntil && row.rateLimitedUntil > Date.now()) {
    return `Recovery probe eligible ${new Date(row.rateLimitedUntil).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  }
  if (row.recentFailureCount >= 3) return "Bounded auto-recovery exhausted — needs owner review";
  return "No automatic recovery (credential/configuration problem) — needs owner review";
}

// ---- model_routing_decisions -------------------------------------------

export interface RoutingCandidateSummary {
  provider: string;
  modelId: string;
  score: number;
}

export interface RecordRoutingDecisionInput {
  projectId?: string | null;
  taskId?: string | null;
  roleId: string;
  requiredCapability: string;
  candidateModels: RoutingCandidateSummary[];
  selectedProvider: string;
  selectedModel: string;
  selectionReason: string;
  fallbacksUsed?: RoutingCandidateSummary[] | null;
  attempts: number;
  result: "SUCCEEDED" | "FAILED" | "ESCALATED";
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number;
}

export interface ModelRoutingDecisionRow {
  id: string;
  projectId: string | null;
  taskId: string | null;
  roleId: string;
  requiredCapability: string;
  candidateModels: string;
  selectedProvider: string;
  selectedModel: string;
  selectionReason: string;
  fallbacksUsed: string | null;
  attempts: number;
  result: "SUCCEEDED" | "FAILED" | "ESCALATED";
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  createdAt: number;
}

export function recordRoutingDecision(db: DatabaseSync, input: RecordRoutingDecisionInput): ModelRoutingDecisionRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO model_routing_decisions
      (id, projectId, taskId, roleId, requiredCapability, candidateModels, selectedProvider, selectedModel, selectionReason, fallbacksUsed, attempts, result, latencyMs, inputTokens, outputTokens, costUsd, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId ?? null,
    input.taskId ?? null,
    input.roleId,
    input.requiredCapability,
    JSON.stringify(input.candidateModels),
    input.selectedProvider,
    input.selectedModel,
    input.selectionReason,
    input.fallbacksUsed && input.fallbacksUsed.length > 0 ? JSON.stringify(input.fallbacksUsed) : null,
    input.attempts,
    input.result,
    input.latencyMs ?? null,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.costUsd ?? 0,
    now,
  );
  return db.prepare("SELECT * FROM model_routing_decisions WHERE id = ?").get(id) as unknown as ModelRoutingDecisionRow;
}

export function listRoutingDecisions(db: DatabaseSync, filters: { projectId?: string; limit?: number } = {}): ModelRoutingDecisionRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.projectId) {
    clauses.push("projectId = ?");
    params.push(filters.projectId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filters.limit ?? 50;
  return db.prepare(`SELECT * FROM model_routing_decisions ${where} ORDER BY createdAt DESC LIMIT ?`).all(...params, limit) as unknown as ModelRoutingDecisionRow[];
}
