import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProjectModelPolicy, getAppliedRouting, type ProjectModelPolicy } from "../domain/model-routing.ts";

/**
 * Local multi-model routing (Phase 8 "local multi-model routing" follow-up,
 * Parts C/D/F/M) — the ONLY place in the codebase allowed to decide which
 * real Ollama model a given role/attempt should use. agent-runner.ts calls
 * this and passes the result straight to `new OllamaAdapter({ model })`;
 * no other code (UI, individual agent prompts) may choose a model name.
 *
 * Capability categories exist so role->model routing survives future model
 * changes without touching role logic: roles map to a capability once,
 * models map to capabilities separately (here, as a pre-benchmark default
 * chain; later, benchmark evidence can override it via
 * `recommended_model_routing`, applied only by an explicit owner action —
 * see domain/model-routing.ts).
 */

export type ModelCapability = "GENERAL" | "REASONING" | "CODING" | "REVIEW" | "FAST";

export const MODEL_CAPABILITIES: readonly ModelCapability[] = ["GENERAL", "REASONING", "CODING", "REVIEW", "FAST"];

/** Every real, non-orchestrator agent role this office currently has, mapped once to the capability its work most resembles. Unknown/future role ids fall back to GENERAL (see `capabilityForRole`) rather than throwing — a new role should never crash routing. */
const ROLE_CAPABILITY: Readonly<Record<string, ModelCapability>> = {
  "product-owner": "GENERAL",
  "research-agent": "GENERAL",
  "ui-ux-agent": "GENERAL",
  "solution-architect": "REASONING",
  "frontend-developer": "CODING",
  "backend-developer": "CODING",
  "qa-agent": "REVIEW",
  "security-reviewer": "REVIEW",
  "code-reviewer": "REVIEW",
  "release-agent": "FAST",
  orchestrator: "GENERAL",
};

export function capabilityForRole(roleId: string): ModelCapability {
  return ROLE_CAPABILITY[roleId] ?? "GENERAL";
}

/**
 * Pre-benchmark default preference chain per capability — used whenever no
 * owner-applied `recommended_model_routing` entry exists yet for that
 * capability. `gemma4:latest` leads every chain deliberately: it is the
 * model already proven across every real Phase 8 acceptance run this
 * project has done, so keeping it first is the conservative choice, not an
 * assumption that it's actually the *best* model for every capability —
 * that question is exactly what the benchmark (Part G onward) exists to
 * answer. Once a benchmark's recommendation is applied, it takes priority
 * over this chain for its capability.
 */
const DEFAULT_CAPABILITY_CHAIN: Readonly<Record<ModelCapability, readonly string[]>> = {
  GENERAL: ["gemma4:latest", "qwen3.6:latest"],
  REASONING: ["gemma4:latest", "qwen3.6:latest"],
  CODING: ["gemma4:latest", "qwen3.6:latest"],
  REVIEW: ["gemma4:latest", "qwen3.6:latest"],
  FAST: ["gemma4:latest", "qwen3.6:latest"],
};

/** Thrown when the owner's own explicit configuration (SINGLE_MODEL, or a CUSTOM role mapping) names a model that isn't actually installed — routing must never silently substitute a different model for an explicit owner choice (Part F). Callers (agent-runner.ts) catch this and synthesize a normal FAILED task result, the same way the release-readiness and intent-consistency gates already do. */
export class ModelUnavailableError extends Error {
  readonly requestedModel: string;
  readonly reason: string;

  constructor(requestedModel: string, reason: string) {
    super(`Requested local model "${requestedModel}" is not available: ${reason}`);
    this.name = "ModelUnavailableError";
    this.requestedModel = requestedModel;
    this.reason = reason;
  }
}

export interface ModelFailureContext {
  /** true only for a real task/deliverable failure (QA failure, bad implementation, review rejection) — never for a provider/operational hiccup (timeout, malformed JSON, connection error), which must keep retrying the SAME model per the existing bounded operational-retry logic and never trigger model escalation. */
  isSemanticFailure: boolean;
  /** The model actually used on the immediately preceding real attempt, so escalation can move past it rather than repeating it. */
  previousModel?: string | null;
}

export interface SelectModelInput {
  role: string;
  /** Accepted for interface completeness / future task-shaped routing decisions; not currently inspected. */
  task?: unknown;
  project: { id: string };
  attemptNumber?: number;
  failureContext?: ModelFailureContext;
  /** The real, currently-installed local models, as detected from the Ollama server — never a hardcoded or client-supplied list (Part V). */
  availableModels: readonly string[];
}

export interface SelectModelResult {
  model: string;
  reason: string;
  capability: ModelCapability;
}

/** Picks the first chain entry that's actually installed, skipping any entry in `avoid`; if every installed entry is being avoided (escalation exhausted every known option), stays on the strongest installed entry rather than looping back to a model that already failed. */
function pickFromChain(chain: readonly string[], available: ReadonlySet<string>, avoid: ReadonlySet<string>): string | undefined {
  const installed = chain.filter((m) => available.has(m));
  if (installed.length === 0) return undefined;
  const notAvoided = installed.filter((m) => !avoid.has(m));
  return notAvoided[0] ?? installed[installed.length - 1];
}

export class LocalModelRouter {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  selectModel(input: SelectModelInput): SelectModelResult {
    const available = new Set(input.availableModels);
    if (available.size === 0) {
      throw new ModelUnavailableError("(none)", "no local Ollama models are currently installed/detected.");
    }

    const policy: ProjectModelPolicy = getProjectModelPolicy(this.db, input.project.id);
    const capability = capabilityForRole(input.role);

    if (policy.mode === "SINGLE_MODEL" && policy.singleModel) {
      if (!available.has(policy.singleModel)) {
        throw new ModelUnavailableError(policy.singleModel, "the project's SINGLE_MODEL policy names a model that is not currently installed.");
      }
      return { model: policy.singleModel, reason: `Owner SINGLE_MODEL policy: always use "${policy.singleModel}".`, capability };
    }

    if (policy.mode === "CUSTOM" && policy.customMapping?.[input.role]) {
      const mapped = policy.customMapping[input.role]!;
      if (!available.has(mapped)) {
        throw new ModelUnavailableError(mapped, `the project's CUSTOM policy maps role "${input.role}" to a model that is not currently installed.`);
      }
      return { model: mapped, reason: `Owner CUSTOM policy: role "${input.role}" is pinned to "${mapped}".`, capability };
    }

    // AUTO — or CUSTOM with no override for this specific role, which
    // falls through to the same capability-driven behavior AUTO uses.
    const isSemanticEscalation = Boolean(input.failureContext?.isSemanticFailure && (input.attemptNumber ?? 1) > 1);
    const avoid = isSemanticEscalation && input.failureContext?.previousModel ? new Set([input.failureContext.previousModel]) : new Set<string>();

    const applied = getAppliedRouting(this.db).find((r) => r.capability === capability);
    if (applied && available.has(applied.model) && !avoid.has(applied.model)) {
      return {
        model: applied.model,
        reason: `Benchmark-derived recommended routing for ${capability} (applied): ${applied.reason}`,
        capability,
      };
    }

    const chainPick = pickFromChain(DEFAULT_CAPABILITY_CHAIN[capability], available, avoid);
    if (chainPick) {
      const escalationNote = isSemanticEscalation
        ? ` Escalated from "${input.failureContext?.previousModel}" after a semantic (non-operational) failure.`
        : "";
      return {
        model: chainPick,
        reason: `Default local ${capability} preference chain (pre-benchmark).${escalationNote}`,
        capability,
      };
    }

    // Nothing in this capability's chain is actually installed — rather
    // than fail a project just because neither of its "preferred" models
    // happens to be present, fall back to whatever local model IS
    // installed. This is the one deliberate, recorded, local-only
    // fallback Part F allows; it never reaches for Claude/LIVE.
    const fallback = [...available][0]!;
    return {
      model: fallback,
      reason: `No configured ${capability} chain model is installed; falling back to the only/first installed local model.`,
      capability,
    };
  }
}
