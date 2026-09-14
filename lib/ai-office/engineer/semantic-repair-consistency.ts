import "server-only";
import type { FileOperationPayload } from "../providers/types.ts";
import { extractStructureNames } from "./semantic-failure-detection.ts";

/**
 * Semantic-repair-scoped consistency guard — a DELIBERATELY SEPARATE
 * validator from `lib/ai-office/agents/intent-consistency.ts`, added
 * after a real, live TaskFlow repair attempt failed safely for the
 * wrong reason: the generic whole-product judge
 * (`checkRetryDriftBeforeMaterialization`) asks "does this candidate
 * still serve the authoritative user request?" — a good question for
 * normal planning/development/broad corrective retries, but the WRONG
 * question for an approved, narrowly-scoped semantic repair, which
 * already has a structured contract to validate against instead of a
 * vague whole-project comparison. The generic guard rejected a
 * correctly-targeted repair with an invented, contradictory
 * reinterpretation of the original request ("the original request was
 * only the TaskStore class methods") — conflating overall project
 * intent with repair scope.
 *
 * `lib/ai-office/agents/intent-consistency.ts` is intentionally
 * UNTOUCHED by this file: the existing whole-product guard remains
 * exactly as it was, still the checker every NORMAL (non-repair)
 * corrective attempt uses. This module is used ONLY when
 * `semantic-repair-execution.ts` supplies it as `executeTask`'s new
 * `retryDriftCheckOverride` for an approved semantic repair's one
 * bounded attempt.
 *
 * WHOLE PRODUCT vs PATCH SCOPE are deliberately kept as two distinct
 * inputs here, never merged into one ambiguous "authoritative request"
 * string — see this module's `SemanticRepairConsistencyInput`: the
 * local judge (when reached at all) is asked TWO separate questions
 * (`productIntentPreserved`, `repairScopeSatisfied`) and must never be
 * allowed to redefine what the original user asked for based on the
 * narrower repair contract.
 */

export interface SemanticRepairConsistencyInput {
  /** The WHOLE PRODUCT's original request — never redefined or narrowed by the repair contract below. */
  authoritativeUserRequest: string;
  /** The approved repair contract's own authoritative structure (e.g. "TaskStore"). */
  authoritativeContract: string;
  /** The repair plan's own allowed file paths — the ONLY paths a proposed operation may touch. */
  allowedFilePaths: string[];
  requiredChanges: string[];
  mustPreserve: string[];
  exactFailureReason: string;
  currentFiles: Array<{ path: string; content: string }>;
  proposedOperations: FileOperationPayload[];
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export type SemanticRepairConsistencyOutcome = "consistent" | "inconsistent" | "unavailable";

export interface SemanticRepairConsistencyResult {
  outcome: SemanticRepairConsistencyOutcome;
  /** A precise, structural reason whenever one is available (Section 10 of the follow-up brief: "avoid vague 'product identity changed' when a more precise structural reason is available") — only falls back to a model-provided free-text reason when no deterministic rule caught the problem. */
  reason: string;
}

/**
 * Section 3 — deterministic structural checks, zero AI cost, run BEFORE
 * any model is ever consulted. Each produces a precise, actionable
 * rejection reason rather than a vague verdict.
 */
export function checkStructuralRepairScope(input: Pick<SemanticRepairConsistencyInput, "allowedFilePaths" | "authoritativeContract" | "currentFiles" | "proposedOperations">): { ok: true } | { ok: false; reason: string } {
  const allowed = new Set(input.allowedFilePaths);

  for (const op of input.proposedOperations) {
    if (!allowed.has(op.path)) {
      return {
        ok: false,
        reason: `REPAIR SCOPE REJECTED — Out-of-scope file: ${op.path}. The approved repair plan only allows changes to: ${input.allowedFilePaths.join(", ") || "(none)"}.`,
      };
    }
  }

  const deletedPaths = new Set(input.proposedOperations.filter((op) => op.action === "delete").map((op) => op.path));
  for (const path of deletedPaths) {
    return {
      ok: false,
      reason: `REPAIR SCOPE REJECTED — Unexpected file deletion: ${path}. A semantic repair may modify allowed files but must never delete one.`,
    };
  }

  // Authoritative contract identifiers (named classes/interfaces) must
  // still exist somewhere in the proposed content for the files that
  // used to establish them — a repair may fix a method's body, but must
  // never quietly remove or rename the established contract itself.
  if (input.authoritativeContract && input.authoritativeContract !== "(none identified)" && input.authoritativeContract !== "(conflicting — see rationale)") {
    const contractNames = input.authoritativeContract.split(",").map((s) => s.trim()).filter(Boolean);
    const currentlyEstablishes = (name: string) => input.currentFiles.some((f) => extractStructureNames(f.content).has(name));
    const writeOps = input.proposedOperations.filter((op) => op.action === "write" && typeof op.content === "string");
    // Only meaningful for a contract name this repair's own current
    // files actually establish — a name mentioned in the contract that
    // never appeared in the pre-repair files isn't this check's concern.
    for (const name of contractNames.filter(currentlyEstablishes)) {
      const stillPresentSomewhere = writeOps.some((op) => extractStructureNames(op.content!).has(name)) || input.currentFiles.some((f) => !input.proposedOperations.some((op) => op.path === f.path) && extractStructureNames(f.content).has(name));
      if (!stillPresentSomewhere) {
        return { ok: false, reason: `AUTHORITATIVE CONTRACT VIOLATION: ${name} class/interface removed.` };
      }
    }
  }

  return { ok: true };
}

function buildRepairScopePrompt(input: SemanticRepairConsistencyInput): string {
  const writeOps = input.proposedOperations.filter((op) => op.action === "write");
  return [
    "You are validating a TARGETED, PRE-APPROVED semantic code repair — not reviewing a whole product from scratch.",
    "",
    "AUTHORITATIVE PRODUCT REQUEST (the whole product the owner originally asked for — this is fixed and must never be reinterpreted or narrowed):",
    input.authoritativeUserRequest,
    "",
    "APPROVED REPAIR CONTRACT (a separate, narrower constraint scoped to fixing one specific reported problem):",
    `- Authoritative contract to preserve: ${input.authoritativeContract}`,
    `- Allowed files: ${input.allowedFilePaths.join(", ") || "(none)"}`,
    `- Required change(s): ${input.requiredChanges.join(" ")}`,
    `- Must preserve: ${input.mustPreserve.join(" ")}`,
    `- Exact failure being repaired: ${input.exactFailureReason}`,
    "",
    "CURRENT FILES (before this patch):",
    ...input.currentFiles.map((f) => `--- ${f.path} ---\n${f.content}`),
    "",
    "PROPOSED PATCH:",
    ...writeOps.map((op) => `--- ${op.path} ---\n${op.content ?? ""}`),
    "",
    "Answer exactly two separate questions:",
    "A. productIntentPreserved: does the patch still serve the AUTHORITATIVE PRODUCT REQUEST above? Do not invent a narrower interpretation of that request based on the repair contract — the product request is unchanged by this repair.",
    "B. repairScopeSatisfied: does the patch comply with the APPROVED REPAIR CONTRACT (stays within allowed files, satisfies the required change, preserves what must be preserved)?",
    "List any changes that fall outside the approved repair scope in outOfScopeChanges (empty array if none).",
    'Respond with ONLY a single JSON object: {"productIntentPreserved": boolean, "repairScopeSatisfied": boolean, "outOfScopeChanges": string[], "reason": string}. "reason" must be one concise sentence.',
  ].join("\n");
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma4:latest";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_INTERNAL_RETRIES = 2;

interface ModelVerdict {
  productIntentPreserved: boolean;
  repairScopeSatisfied: boolean;
  outOfScopeChanges: string[];
  reason: string;
}

async function attemptModelCheck(input: SemanticRepairConsistencyInput): Promise<{ ok: true; verdict: ModelVerdict } | { ok: false; reason: string }> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
  const model = input.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: buildRepairScopePrompt(input), stream: false, format: "json" }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `Ollama responded with HTTP ${response.status}.` };
    const body = (await response.json()) as { response?: string };
    const parsed = JSON.parse(body.response ?? "");
    if (typeof parsed.productIntentPreserved !== "boolean" || typeof parsed.repairScopeSatisfied !== "boolean") {
      return { ok: false, reason: "Model response did not include the required boolean fields." };
    }
    return {
      ok: true,
      verdict: {
        productIntentPreserved: parsed.productIntentPreserved,
        repairScopeSatisfied: parsed.repairScopeSatisfied,
        outOfScopeChanges: Array.isArray(parsed.outOfScopeChanges) ? parsed.outOfScopeChanges.filter((v: unknown) => typeof v === "string") : [],
        reason: typeof parsed.reason === "string" ? parsed.reason : "(no reason given)",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Section 2/4 — the full semantic-repair-scoped consistency check:
 * deterministic structural checks first (free, precise), then — only if
 * those pass and there is anything to actually judge — a repair-scoped
 * model check asking the two separate questions Section 4 specifies.
 * The repair may proceed only if BOTH `productIntentPreserved` AND
 * `repairScopeSatisfied` are true.
 */
export async function checkSemanticRepairConsistency(input: SemanticRepairConsistencyInput): Promise<SemanticRepairConsistencyResult> {
  const structural = checkStructuralRepairScope(input);
  if (!structural.ok) return { outcome: "inconsistent", reason: structural.reason };

  const writeOps = input.proposedOperations.filter((op) => op.action === "write");
  if (writeOps.length === 0) return { outcome: "consistent", reason: "No write operations to validate." };

  let result = await attemptModelCheck(input);
  let retries = 0;
  while (!result.ok && retries < MAX_INTERNAL_RETRIES) {
    retries += 1;
    result = await attemptModelCheck(input);
  }
  if (!result.ok) return { outcome: "unavailable", reason: `Semantic-repair consistency check could not run (${result.reason}).` };

  const { verdict } = result;
  if (verdict.productIntentPreserved && verdict.repairScopeSatisfied) {
    return { outcome: "consistent", reason: verdict.reason };
  }
  if (!verdict.repairScopeSatisfied && verdict.outOfScopeChanges.length > 0) {
    return { outcome: "inconsistent", reason: `REPAIR SCOPE REJECTED — out-of-scope change(s): ${verdict.outOfScopeChanges.join(", ")}.` };
  }
  if (!verdict.productIntentPreserved) {
    return { outcome: "inconsistent", reason: `PRODUCT INTENT VIOLATION: ${verdict.reason}` };
  }
  return { outcome: "inconsistent", reason: `REPAIR SCOPE REJECTED: ${verdict.reason}` };
}
