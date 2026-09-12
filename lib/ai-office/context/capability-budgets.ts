import "server-only";
import type { ModelCapability } from "../agents/model-router.ts";

/**
 * Token economics phase, final hardening — the ONE place every
 * configurable context/output limit for a paid provider call lives, keyed
 * by the same `ModelCapability` routing already uses
 * (`agents/model-router.ts`). Every other module in this phase (the
 * Context Budget Manager, ClaudeAdapter's output ceiling) reads limits
 * from here rather than hardcoding its own number — the explicit "do not
 * scatter token rules around agents" requirement.
 *
 * Three enforced tiers, not two — this phase's explicit hardening over the
 * previous single soft-ceiling design:
 *  - `targetEstimatedInputTokens` — the normal ceiling. Above it, the
 *    Context Budget Manager runs its shrink sequence.
 *  - `burstEstimatedInputTokens` — an explicit, configured tolerance above
 *    target. If shrinking still leaves the estimate above target but at or
 *    under burst, the call PROCEEDS, but only with an owner-visible
 *    "CONTEXT BUDGET WARNING" telemetry record — never silently. Above
 *    burst, the call is BLOCKED outright.
 *  - `GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS` — a single,
 *    capability-independent emergency ceiling (see below) that blocks
 *    regardless of what any capability's own burst is configured to,
 *    including via a misconfigured override.
 */

export interface CapabilityContextBudget {
  /** The normal ceiling — the Context Budget Manager shrinks context (existing reduction order) once the estimate exceeds this, before ever considering burst or blocking. */
  targetEstimatedInputTokens: number;
  /** An explicit, configured tolerance above target — reachable only after shrinking has already run and failed to bring the estimate back under target. Proceeding here always emits a CONTEXT BUDGET WARNING (Part 2); it is never silent. Must never be sent unbounded — a call still above this is BLOCKED, never trimmed further and sent anyway. */
  burstEstimatedInputTokens: number;
  /** The real `max_tokens` ceiling passed to the provider and used for the worst-case cost reservation — role-specific output limits, never a flat number for every role. */
  maxOutputTokens: number;
  /** How many real workspace files may be included at most (relevant-files + remediation currentFiles combined) — 0 for a role with no legitimate reason to see file content. */
  maxFiles: number;
  /** Per-file content cap, in estimated tokens — applied only as a shrink step, never up front, so a file under this size is never needlessly truncated. */
  maxTokensPerFile: number;
  /** How many of a role's scoped `relevantArtifacts` may be included — context-builder.ts already returns at most one (the latest) per allowed artifact type, so this is a defensive ceiling, not the primary control. */
  maxArtifacts: number;
  /** How many `relevantDecisions` may be included before older ones are dropped in favor of the compact project-memory summary that already captures their gist. */
  maxDecisions: number;
}

/**
 * Absolute, capability-independent ceiling — the final emergency safety
 * net regardless of any capability's own (even overridden) burst value.
 * Crossing this BLOCKS the call outright; it is never silently exceeded.
 * Configurable via `AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS` (falls
 * back to the default on anything missing/invalid — never disabled).
 */
const DEFAULT_GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS = 40_000;

export function getGlobalAbsoluteMaxEstimatedInputTokens(): number {
  const raw = process.env.AI_OFFICE_CONTEXT_GLOBAL_ABSOLUTE_MAX_TOKENS;
  if (!raw) return DEFAULT_GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS;
}

/** Kept as a named export for callers/tests that just need "the default absolute ceiling" without reading env — `getGlobalAbsoluteMaxEstimatedInputTokens()` is the one actually consulted at call time. */
export const GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS = DEFAULT_GLOBAL_ABSOLUTE_MAX_ESTIMATED_INPUT_TOKENS;

/**
 * Deliberately conservative defaults, sized to the current structured-
 * output/fileOperations contract: a CODING role needs enough headroom for
 * several real files plus a fileOperations-shaped response that re-emits
 * full file content; a FAST/GENERAL role emitting a short requirements or
 * review artifact needs far less of either. Burst is a real, deliberate
 * tolerance above target (not an arbitrary multiplier) — sized so a
 * genuinely borderline task can still complete without a hard refusal,
 * while staying well under the 40k global absolute ceiling.
 */
const DEFAULTS: Record<ModelCapability, CapabilityContextBudget> = {
  GENERAL: { targetEstimatedInputTokens: 6_000, burstEstimatedInputTokens: 8_000, maxOutputTokens: 1_024, maxFiles: 0, maxTokensPerFile: 0, maxArtifacts: 3, maxDecisions: 10 },
  REASONING: { targetEstimatedInputTokens: 9_000, burstEstimatedInputTokens: 12_000, maxOutputTokens: 2_048, maxFiles: 4, maxTokensPerFile: 1_500, maxArtifacts: 4, maxDecisions: 15 },
  CODING: { targetEstimatedInputTokens: 18_000, burstEstimatedInputTokens: 24_000, maxOutputTokens: 4_096, maxFiles: 12, maxTokensPerFile: 3_000, maxArtifacts: 3, maxDecisions: 10 },
  REVIEW: { targetEstimatedInputTokens: 10_000, burstEstimatedInputTokens: 14_000, maxOutputTokens: 1_536, maxFiles: 15, maxTokensPerFile: 2_000, maxArtifacts: 3, maxDecisions: 10 },
  FAST: { targetEstimatedInputTokens: 3_000, burstEstimatedInputTokens: 4_000, maxOutputTokens: 512, maxFiles: 0, maxTokensPerFile: 0, maxArtifacts: 2, maxDecisions: 5 },
};

/**
 * Optional deep-partial override, read once per call rather than cached —
 * a single JSON env var (`AI_OFFICE_CONTEXT_BUDGET_OVERRIDES`) rather than
 * one env var per (capability × field), which would multiply into two
 * dozen variables for little real benefit. Malformed/invalid JSON is
 * ignored (falls back to defaults) rather than crashing a paid call.
 * Example: `{"CODING": {"burstEstimatedInputTokens": 30000}}`.
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
