import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getAppliedRouting, NO_QUALIFIED_MODEL } from "../domain/model-routing.ts";
import type { AiPolicyMode } from "../domain/projects.ts";
import { capabilityForRole, type ModelCapability } from "./model-router.ts";

/**
 * Controlled Claude LIVE pilot — the routing layer ABOVE
 * `LocalModelRouter`. `LocalModelRouter` only ever decides which
 * *local* model to use; it has no concept of a paid provider and is
 * completely unchanged by this file. `ProviderRouter` decides LOCAL vs
 * CLAUDE first; agent-runner.ts only calls into `LocalModelRouter` at
 * all once this has already said "LOCAL."
 *
 * Deliberately evidence-driven, not a hardcoded role→provider table:
 * a capability routes to CLAUDE under HYBRID only when the real,
 * owner-applied benchmark recommendation for that capability is the
 * `NO_QUALIFIED_MODEL` sentinel (domain/model-routing.ts) — i.e. the
 * office has real, applied evidence that no installed local model is
 * good enough. A capability with no applied recommendation at all
 * (never benchmarked, or benchmarked but not yet applied) defaults to
 * LOCAL — the existing, already-proven, free default — never to
 * Claude just because evidence doesn't exist yet.
 */

export type ProviderChoice = "LOCAL" | "CLAUDE";

export interface ProviderRoutingDecision {
  provider: ProviderChoice;
  capability: ModelCapability;
  reason: string;
}

function capabilityHasQualifiedLocalModel(db: DatabaseSync, capability: ModelCapability): boolean {
  const applied = getAppliedRouting(db).find((r) => r.capability === capability);
  if (!applied) return true; // no applied evidence against local yet — default to the free, already-proven path
  return applied.model !== NO_QUALIFIED_MODEL;
}

export interface RouteProviderInput {
  role: string;
  project: { aiPolicyMode: AiPolicyMode };
}

/**
 * The one place that decides LOCAL vs CLAUDE. `CLAUDE_ONLY` and
 * `LOCAL_ONLY` are unconditional by the owner's own explicit choice —
 * neither ever looks at benchmark evidence. Only `HYBRID` consults
 * real evidence, and only for the capability the role maps to; a
 * project's `aiPolicyMode` is never inferred, only ever read from the
 * project row the caller already has.
 */
export function routeProvider(db: DatabaseSync, input: RouteProviderInput): ProviderRoutingDecision {
  const capability = capabilityForRole(input.role);

  if (input.project.aiPolicyMode === "LOCAL_ONLY") {
    return { provider: "LOCAL", capability, reason: "Project AI policy is LOCAL_ONLY — Claude is never considered." };
  }
  if (input.project.aiPolicyMode === "CLAUDE_ONLY") {
    return { provider: "CLAUDE", capability, reason: "Project AI policy is CLAUDE_ONLY." };
  }

  // HYBRID.
  if (capabilityHasQualifiedLocalModel(db, capability)) {
    return { provider: "LOCAL", capability, reason: `A qualified local model is applied for ${capability} — using it under HYBRID policy.` };
  }
  return {
    provider: "CLAUDE",
    capability,
    reason: `No qualified local model is applied for ${capability} (real benchmark evidence) — routing to Claude under HYBRID policy.`,
  };
}
