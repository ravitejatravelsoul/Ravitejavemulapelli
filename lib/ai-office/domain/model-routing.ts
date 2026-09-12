import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * Persistence for local multi-model routing + benchmarking (migration
 * 005) — three independent concerns, one file per the same "each is a
 * small, independent, single-table-ish repository" convention as
 * lib/ai-office/domain/workspace.ts:
 *   1. Per-project owner model policy (AUTO / SINGLE_MODEL / CUSTOM),
 *      stored as three plain columns on `projects` rather than a
 *      separate table — it's 1:1 with a project and small enough that a
 *      join table would add nothing.
 *   2. `benchmark_results` — one row per (model, scenario) diagnostic
 *      run, entirely separate from real project/task history.
 *   3. `recommended_model_routing` — the current benchmark-derived
 *      recommendation per capability, with an explicit `appliedAt` so a
 *      fresh benchmark can update the *recommendation* without ever
 *      silently changing what AUTO mode actually uses until the owner
 *      approves it (Phase 8 follow-up Part L).
 */

export type ModelPolicyMode = "AUTO" | "SINGLE_MODEL" | "CUSTOM";
const VALID_MODEL_POLICY_MODES: ReadonlySet<string> = new Set(["AUTO", "SINGLE_MODEL", "CUSTOM"]);

export interface ProjectModelPolicy {
  mode: ModelPolicyMode;
  singleModel: string | null;
  /** roleId -> model name */
  customMapping: Record<string, string> | null;
}

const DEFAULT_POLICY: ProjectModelPolicy = { mode: "AUTO", singleModel: null, customMapping: null };

export function getProjectModelPolicy(db: DatabaseSync, projectId: string): ProjectModelPolicy {
  const row = db
    .prepare("SELECT modelPolicyMode, singleModelOverride, customRoleModelMapping FROM projects WHERE id = ?")
    .get(projectId) as unknown as { modelPolicyMode: string; singleModelOverride: string | null; customRoleModelMapping: string | null } | undefined;
  if (!row) return DEFAULT_POLICY;

  const mode = VALID_MODEL_POLICY_MODES.has(row.modelPolicyMode) ? (row.modelPolicyMode as ModelPolicyMode) : "AUTO";
  let customMapping: Record<string, string> | null = null;
  if (row.customRoleModelMapping) {
    try {
      const parsed = JSON.parse(row.customRoleModelMapping) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) customMapping = parsed as Record<string, string>;
    } catch {
      customMapping = null; // malformed stored JSON fails closed to "no override" rather than throwing
    }
  }
  return { mode, singleModel: row.singleModelOverride, customMapping };
}

/** Owner-only write path (enforced by the Server Action that calls this, not here) — validates `mode` defensively regardless. */
export function setProjectModelPolicy(db: DatabaseSync, projectId: string, policy: ProjectModelPolicy): void {
  if (!VALID_MODEL_POLICY_MODES.has(policy.mode)) {
    throw new Error(`Invalid model policy mode: "${policy.mode}".`);
  }
  db.prepare("UPDATE projects SET modelPolicyMode = ?, singleModelOverride = ?, customRoleModelMapping = ?, updatedAt = ? WHERE id = ?").run(
    policy.mode,
    policy.singleModel,
    policy.customMapping ? JSON.stringify(policy.customMapping) : null,
    Date.now(),
    projectId,
  );
}

// ---- benchmark_results ----------------------------------------------------

export type BenchmarkStatus = "PASS" | "PARTIAL" | "FAIL";

export interface BenchmarkResultRow {
  id: string;
  model: string;
  scenarioId: string;
  roleId: string;
  status: BenchmarkStatus;
  score: number;
  latencyMs: number;
  promptTokens: number | null;
  outputTokens: number | null;
  retries: number;
  timedOut: 0 | 1;
  malformedJson: 0 | 1;
  intentConsistencyOutcome: string | null;
  fileOperationValid: 0 | 1 | null;
  qaResult: string | null;
  defectDiagnosed: 0 | 1 | null;
  matchesRequest: 0 | 1 | null;
  details: string | null;
  createdAt: number;
}

export interface RecordBenchmarkResultInput {
  model: string;
  scenarioId: string;
  roleId: string;
  status: BenchmarkStatus;
  score: number;
  latencyMs: number;
  promptTokens?: number;
  outputTokens?: number;
  retries?: number;
  timedOut?: boolean;
  malformedJson?: boolean;
  intentConsistencyOutcome?: string;
  fileOperationValid?: boolean;
  qaResult?: string;
  defectDiagnosed?: boolean;
  matchesRequest?: boolean;
  details?: Record<string, unknown>;
}

export function recordBenchmarkResult(db: DatabaseSync, input: RecordBenchmarkResultInput): BenchmarkResultRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO benchmark_results
      (id, model, scenarioId, roleId, status, score, latencyMs, promptTokens, outputTokens, retries, timedOut, malformedJson, intentConsistencyOutcome, fileOperationValid, qaResult, defectDiagnosed, matchesRequest, details, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.model,
    input.scenarioId,
    input.roleId,
    input.status,
    input.score,
    input.latencyMs,
    input.promptTokens ?? null,
    input.outputTokens ?? null,
    input.retries ?? 0,
    input.timedOut ? 1 : 0,
    input.malformedJson ? 1 : 0,
    input.intentConsistencyOutcome ?? null,
    input.fileOperationValid === undefined ? null : input.fileOperationValid ? 1 : 0,
    input.qaResult ?? null,
    input.defectDiagnosed === undefined ? null : input.defectDiagnosed ? 1 : 0,
    input.matchesRequest === undefined ? null : input.matchesRequest ? 1 : 0,
    input.details ? JSON.stringify(input.details) : null,
    now,
  );
  return db.prepare("SELECT * FROM benchmark_results WHERE id = ?").get(id) as unknown as BenchmarkResultRow;
}

export function listBenchmarkResults(db: DatabaseSync, filters: { model?: string; scenarioId?: string } = {}): BenchmarkResultRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.model) {
    clauses.push("model = ?");
    params.push(filters.model);
  }
  if (filters.scenarioId) {
    clauses.push("scenarioId = ?");
    params.push(filters.scenarioId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM benchmark_results ${where} ORDER BY createdAt DESC`).all(...params) as unknown as BenchmarkResultRow[];
}

/** Every distinct model that has ever been benchmarked, most recently benchmarked first — drives the UI's comparison table rows. */
export function listBenchmarkedModels(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT model FROM benchmark_results GROUP BY model ORDER BY MAX(createdAt) DESC").all() as unknown as { model: string }[]
  ).map((r) => r.model);
}

// ---- capability evidence (shared by the benchmark recommendation engine
// and LocalModelRouter's own escalation eligibility check) -----------------
//
// Lives here, the lowest persistence-only layer both `benchmark/
// routing-recommendation.ts` and `agents/model-router.ts` already
// depend on, specifically so there is exactly one definition of "which
// scenarios speak to which capability" and "what counts as qualifying
// evidence" — model-router.ts importing this from
// routing-recommendation.ts (or vice versa) would be circular, since
// routing-recommendation.ts needs `ModelCapability` from
// agents/model-router.ts. Capability is a plain string here, matching
// this file's existing untyped `RecommendedRoutingRow.capability` —
// the stricter `ModelCapability` union lives in agents/model-router.ts
// and both callers narrow to it at their own boundary.

/** Which benchmark scenarios speak to which capability — FAST has no dedicated scenario yet, so it never has qualifying evidence either way. */
export const CAPABILITY_SCENARIOS: Record<string, readonly string[]> = {
  GENERAL: ["product-owner-basic"],
  REASONING: ["architect-static-page"],
  CODING: ["frontend-build", "frontend-bug-fix"],
  REVIEW: ["code-review", "qa-interpretation"],
  FAST: [],
};

/** A model below this success rate for a capability's scenarios has not demonstrated real capability for that work — see routing-recommendation.ts's docblock for the full rationale. */
export const MIN_QUALIFYING_SUCCESS_RATE = 0.5;

/** Sentinel "model" name for a capability where no tested model met the minimum threshold — never matches a real installed model name. */
export const NO_QUALIFIED_MODEL = "NO QUALIFIED LOCAL MODEL";

export type ModelCapabilityEvidence = "qualified" | "unqualified" | "no-evidence";

/**
 * What the stored benchmark evidence says about one model's fitness for
 * one capability — "no-evidence" (never benchmarked on this capability's
 * scenarios) is deliberately distinct from "unqualified" (benchmarked
 * and found wanting): a brand-new, never-tested model is not the same
 * claim as a model with a real, recorded track record of failing.
 */
export function getModelCapabilityEvidence(db: DatabaseSync, model: string, capability: string): ModelCapabilityEvidence {
  const scenarioIds = CAPABILITY_SCENARIOS[capability] ?? [];
  if (scenarioIds.length === 0) return "no-evidence";

  const rows = scenarioIds.flatMap((scenarioId) => listBenchmarkResults(db, { model, scenarioId }));
  if (rows.length === 0) return "no-evidence";

  const passCount = rows.filter((r) => r.status === "PASS").length;
  return passCount / rows.length >= MIN_QUALIFYING_SUCCESS_RATE ? "qualified" : "unqualified";
}

// ---- recommended_model_routing ---------------------------------------------

export interface RecommendedRoutingRow {
  capability: string;
  model: string;
  reason: string;
  generatedAt: number;
  appliedAt: number | null;
}

/** Upserted by benchmark-informed routing generation — never touches `appliedAt` on an update, so regenerating a recommendation never silently re-applies it. */
export function upsertRecommendedRouting(db: DatabaseSync, input: { capability: string; model: string; reason: string }): RecommendedRoutingRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO recommended_model_routing (capability, model, reason, generatedAt, appliedAt)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT (capability) DO UPDATE SET model = excluded.model, reason = excluded.reason, generatedAt = excluded.generatedAt, appliedAt = NULL`,
  ).run(input.capability, input.model, input.reason, now);
  return db.prepare("SELECT * FROM recommended_model_routing WHERE capability = ?").get(input.capability) as unknown as RecommendedRoutingRow;
}

export function listRecommendedRouting(db: DatabaseSync): RecommendedRoutingRow[] {
  return db.prepare("SELECT * FROM recommended_model_routing ORDER BY capability").all() as unknown as RecommendedRoutingRow[];
}

/** Owner-only write path (enforced by the calling Server Action) — the ONLY thing that ever sets `appliedAt`; nothing in the benchmark/generation path does this on its own. */
export function applyRecommendedRouting(db: DatabaseSync): RecommendedRoutingRow[] {
  const now = Date.now();
  db.prepare("UPDATE recommended_model_routing SET appliedAt = ?").run(now);
  return listRecommendedRouting(db);
}

/** Only the capabilities whose current recommendation has actually been approved — what AUTO mode is allowed to use. */
export function getAppliedRouting(db: DatabaseSync): RecommendedRoutingRow[] {
  return db.prepare("SELECT * FROM recommended_model_routing WHERE appliedAt IS NOT NULL ORDER BY capability").all() as unknown as RecommendedRoutingRow[];
}
