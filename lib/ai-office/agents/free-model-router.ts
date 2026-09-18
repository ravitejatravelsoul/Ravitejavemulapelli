import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listModelRegistryEntries, isProviderEnabled, type ModelRegistryRow } from "../domain/model-registry.ts";
import { isFreeModelAllowed, getFreeProviderConfig } from "../providers/free/free-provider-config.ts";
import type { TaskCapability } from "./free-model-capabilities.ts";

/** Deterministic extension of ProviderRouter/LocalModelRouter used by opted-in
 * free projects in the existing AgentRunner. No model call is made for routing.
 * Eligibility requires explicit free status, health, benchmark qualification,
 * all task capabilities, sufficient context and an available rate-limit window.
 */

export interface CandidateScore {
  provider: string;
  modelId: string;
  score: number;
  /** Human-readable factors that produced this score — surfaced in the routing-history UI and `selectionReason`. */
  reasons: string[];
}

export interface SelectFreeModelInput {
  capability: TaskCapability;
  requiredCapabilities?: readonly TaskCapability[];
  estimatedOutputTokens?: number;
  /** "provider:modelId" entries to skip — already tried and failed earlier in this same task's fallback chain. */
  avoid?: ReadonlySet<string>;
  /** A rough estimate of this call's prompt size, for context-fit filtering — optional; omitted entirely skips the context-window check. */
  estimatedInputTokens?: number;
}

export interface SelectFreeModelResult {
  provider: string;
  modelId: string;
  reason: string;
  /** Every eligible candidate, ranked best-first — agent-runner.ts walks this list for cross-provider fallback. */
  candidates: CandidateScore[];
}

function parseCapabilities(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Deterministic scoring — every factor the brief asks for
 * (capabilityMatch, benchmarkScore, health, structuredOutputReliability,
 * recentSuccessRate, latency, remainingQuota/rate-limit status,
 * contextFit, failureHistory) except cost (always 0 for a free
 * candidate, so never scored). Returns `null` for a model that fails a
 * hard eligibility gate (disabled, wrong capability, currently
 * rate-limited/unavailable, avoided, or too small a context window) —
 * those never appear in the ranked candidate list at all, rather than
 * being scored low.
 */
function scoreModel(row: ModelRegistryRow, input: SelectFreeModelInput, now: number, recent: Array<{ status: string; structured: number }> = []): CandidateScore | null {
  const key = `${row.provider}:${row.modelId}`;
  if (!row.enabled || !isFreeModelAllowed(row.provider, row.modelId)) return null;
  if ((row.provider === "groq" || row.provider === "gemini" || row.provider === "openrouter") && !getFreeProviderConfig(row.provider).configured) return null;
  if (!row.freeTier || !row.qualified || row.health === "UNKNOWN") return null;
  if (!["groq", "gemini", "openrouter", "ollama"].includes(row.provider)) return null;
  if (input.avoid?.has(key)) return null;
  if (!parseCapabilities(row.capabilities).includes(input.capability)) return null;
  if (input.requiredCapabilities?.some((c) => !parseCapabilities(row.capabilities).includes(c))) return null;
  if (input.requiredCapabilities?.includes("STRUCTURED_OUTPUT") && !row.structuredOutput) return null;
  if (row.health === "UNAVAILABLE" && (!row.rateLimitedUntil || row.rateLimitedUntil > now)) return null;
  if (row.rateLimitedUntil && row.rateLimitedUntil > now) return null;
  if (row.contextWindow && input.estimatedInputTokens && input.estimatedInputTokens + (input.estimatedOutputTokens ?? 0) > row.contextWindow) return null;

  const reasons: string[] = [`covers ${input.capability}`];
  let score = 40; // capability-match baseline — every remaining candidate already cleared this gate

  if (row.qualified) {
    score += 20;
    reasons.push("benchmark-qualified");
  }

  if (row.benchmarkScore != null) {
    score += (row.benchmarkScore / 100) * 25;
    reasons.push(`benchmark score ${row.benchmarkScore.toFixed(0)}/100`);
  }

  if (row.health === "HEALTHY") {
    score += 10;
    reasons.push("healthy");
  } else if (row.health === "DEGRADED") {
    score += 2;
    reasons.push("degraded health");
  }

  const totalRuns = recent.length || row.tasksCompleted + row.tasksFailed;
  if (totalRuns > 0) {
    const successRate = recent.length ? recent.filter(r => r.status === "SUCCEEDED").length / recent.length : row.tasksCompleted / totalRuns;
    score += successRate * 15;
    reasons.push(`${Math.round(successRate * 100)}% recent success rate (${totalRuns} run(s))`);
  } else {
    score += 5; // small credit for untested — never penalized for lack of history
  }

  score -= Math.min(row.recentFailureCount, 5) * 4;
  if (row.recentFailureCount > 0) reasons.push(`${row.recentFailureCount} recent consecutive failure(s)`);

  if (row.avgLatencyMs != null) {
    score += Math.max(0, 10 - row.avgLatencyMs / 1000);
    reasons.push(`avg latency ${Math.round(row.avgLatencyMs)}ms`);
  }

  if (row.structuredOutput) {
    score += 3;
    if (recent.length) {
      const reliability = recent.filter(r => r.structured).length / recent.length;
      score += reliability * 10;
      reasons.push(`${Math.round(reliability * 100)}% structured-output reliability`);
    }
    reasons.push("native structured-output support");
  }

  return { provider: row.provider, modelId: row.modelId, score, reasons };
}

/** The single entry point agent-runner.ts calls for a `freeModelOrchestration` project — never throws; returns `null` when no eligible free model exists for the capability right now (agent-runner.ts turns that into a normal, honest task failure that flows through the existing retry/escalation path, exactly like `ModelUnavailableError` does for LocalModelRouter). */
export function selectFreeModel(db: DatabaseSync, input: SelectFreeModelInput): SelectFreeModelResult | null {
  const now = Date.now();
  const rows = listModelRegistryEntries(db, { enabledOnly: true }).filter((r) => isProviderEnabled(db, r.provider));

  const scored = rows
    .map((row) => scoreModel(row, input, now, db.prepare(
      `SELECT json_extract(payload, '$.status') AS status, json_extract(payload, '$.structuredOutputValid') AS structured
       FROM messages_events WHERE type = 'model.request' AND json_extract(payload, '$.provider') = ?
       AND json_extract(payload, '$.model') = ? ORDER BY createdAt DESC LIMIT 20`,
    ).all(row.provider, row.modelId) as Array<{ status: string; structured: number }>))
    .filter((c): c is CandidateScore => c !== null)
    .sort((a, b) => b.score - a.score || `${a.provider}:${a.modelId}`.localeCompare(`${b.provider}:${b.modelId}`));

  if (scored.length === 0) return null;

  const best = scored[0]!;
  return {
    provider: best.provider,
    modelId: best.modelId,
    reason: `Highest deterministic score (${best.score.toFixed(1)}) among ${scored.length} eligible free model(s) for ${input.capability}: ${best.reasons.join(", ")}.`,
    candidates: scored,
  };
}
