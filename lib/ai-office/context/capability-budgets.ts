import "server-only";
import type { ModelCapability } from "../agents/model-router.ts";

/**
 * Token economics phase — the ONE place every configurable context/output
 * limit for a paid provider call lives, keyed by the same `ModelCapability`
 * routing already uses (`agents/model-router.ts`). Every other module in
 * this phase (the Context Budget Manager, ClaudeAdapter's output ceiling)
 * reads limits from here rather than hardcoding its own number — the
 * explicit "do not scatter token rules around agents" requirement.
 */

export interface CapabilityContextBudget {
  /** Soft ceiling — the Context Budget Manager shrinks context (Part 6's reduction order) once the estimate exceeds this, before ever blocking. */
  maxEstimatedInputTokens: number;
  /** The real `max_tokens` ceiling passed to the provider and used for the worst-case cost reservation — Part 7's "role-specific output limits," replacing a flat 8192 for every role. */
  maxOutputTokens: number;
  /** How many real workspace files may be included at most (relevant-files + remediation currentFiles combined) — 0 for a role with no legitimate reason to see file content. */
  maxFiles: number;
  /** Per-file content cap, in estimated tokens — applied only as a shrink step (Part 6e), never up front, so a file under this size is never needlessly truncated. */
  maxTokensPerFile: number;
  /** How many of a role's scoped `relevantArtifacts` may be included — context-builder.ts already returns at most one (the latest) per allowed artifact type, so this is a defensive ceiling, not the primary control. */
  maxArtifacts: number;
  /** How many `relevantDecisions` may be included before older ones are dropped in favor of the compact project-memory summary that already captures their gist. */
  maxDecisions: number;
}

/**
 * Absolute, capability-independent ceiling (Part 6's "still above the hard
 * limit" rule) — reached only after every shrink step has already run and
 * failed to bring the estimate under the capability's own soft ceiling.
 * Crossing this BLOCKS the call outright; it is never silently exceeded.
 */
export const HARD_MAX_ESTIMATED_INPUT_TOKENS = 40_000;

/**
 * Deliberately conservative defaults, sized to the current structured-
 * output/fileOperations contract (Part 7): a CODING role needs enough
 * headroom for several real files plus a fileOperations-shaped response
 * that re-emits full file content; a FAST/GENERAL role emitting a short
 * requirements or review artifact needs far less of either.
 */
const DEFAULTS: Record<ModelCapability, CapabilityContextBudget> = {
  GENERAL: { maxEstimatedInputTokens: 6_000, maxOutputTokens: 1_024, maxFiles: 0, maxTokensPerFile: 0, maxArtifacts: 3, maxDecisions: 10 },
  REASONING: { maxEstimatedInputTokens: 9_000, maxOutputTokens: 2_048, maxFiles: 4, maxTokensPerFile: 1_500, maxArtifacts: 4, maxDecisions: 15 },
  CODING: { maxEstimatedInputTokens: 18_000, maxOutputTokens: 4_096, maxFiles: 12, maxTokensPerFile: 3_000, maxArtifacts: 3, maxDecisions: 10 },
  REVIEW: { maxEstimatedInputTokens: 10_000, maxOutputTokens: 1_536, maxFiles: 15, maxTokensPerFile: 2_000, maxArtifacts: 3, maxDecisions: 10 },
  FAST: { maxEstimatedInputTokens: 3_000, maxOutputTokens: 512, maxFiles: 0, maxTokensPerFile: 0, maxArtifacts: 2, maxDecisions: 5 },
};

/**
 * Optional deep-partial override, read once per call rather than cached —
 * a single JSON env var (`AI_OFFICE_CONTEXT_BUDGET_OVERRIDES`) rather than
 * one env var per (capability × field), which would multiply into two
 * dozen variables for little real benefit. Malformed/invalid JSON is
 * ignored (falls back to defaults) rather than crashing a paid call.
 * Example: `{"CODING": {"maxOutputTokens": 6000}}`.
 */
function readOverrides(): Partial<Record<ModelCapability, Partial<CapabilityContextBudget>>> {
  const raw = process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Partial<Record<ModelCapability, Partial<CapabilityContextBudget>>>;
  } catch {
    return {};
  }
}

export function getCapabilityContextBudget(capability: ModelCapability): CapabilityContextBudget {
  const overrides = readOverrides()[capability];
  return overrides ? { ...DEFAULTS[capability], ...overrides } : DEFAULTS[capability];
}

/** Exposed for tests/telemetry display — never mutated at runtime. */
export const DEFAULT_CAPABILITY_CONTEXT_BUDGETS: Readonly<Record<ModelCapability, CapabilityContextBudget>> = DEFAULTS;
