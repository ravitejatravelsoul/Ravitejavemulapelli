import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { TaskRow } from "../domain/tasks.ts";
import { listFailuresForTask, type FailureRow } from "../domain/project-outputs.ts";
import { isOperationalFailureReason } from "../agents/failure-classification.ts";
import type { RepairPlan, SemanticRepairClassification } from "../domain/semantic-repair.ts";

/**
 * Office Engineer — semantic repair, detection + classification.
 *
 * Real incident this closes: TaskFlow's backend-developer accumulated
 * repeated intent-consistency rejections ("Corrective attempt rejected
 * before applying — it would have changed the product's identity: ...")
 * — a genuinely different failure class from the operational failures
 * (timeouts, malformed JSON) office-engineer.ts's existing
 * runOfficeEngineerCycle already auto-retries. Blindly retrying a
 * semantic rejection just produces the same rejection again, burning
 * real paid attempts for no chance of success.
 *
 * Deterministic and free, per the brief's explicit requirement — "Do not
 * call AI just to detect these patterns. Detection must remain
 * deterministic/free." Nothing in this file ever makes a network call.
 */

/** Recognized semantic-rejection categories — the same three checkpoints intent-consistency.ts's callers in agent-runner.ts actually produce, plus a generic fallback for any other real (non-operational) failure reason. Matching by category first, not raw text, is what lets two differently-worded rejections of the same underlying kind dedupe onto the same signature. */
const KNOWN_CATEGORIES: Array<{ id: string; pattern: RegExp }> = [
  { id: "RETRY_DRIFT_REJECTED", pattern: /would have changed the product's identity/i },
  { id: "DELIVERABLE_MISMATCH", pattern: /does not match the requested product/i },
  { id: "PLAN_INCONSISTENT", pattern: /intent-consistency check failed/i },
];

function categorize(reason: string): string {
  const known = KNOWN_CATEGORIES.find((c) => c.pattern.test(reason));
  if (known) return known.id;
  // Generic fallback signature: normalize whitespace/case and cap length
  // so near-identical free-text reasons (a model's rejection wording can
  // vary slightly run to run) still collapse onto one signature, while
  // genuinely different reasons don't.
  return `GENERIC:${reason.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120)}`;
}

/** Stable fingerprint for a set of failure reasons — same category-set in, same signature out, always. Used both to detect a repeated loop and to recognize "this exact failure was already attempted and escalated." */
export function computeFailureSignature(reasons: string[]): string {
  const categories = Array.from(new Set(reasons.map(categorize))).sort();
  return categories.join("|");
}

export const MIN_SEMANTIC_FAILURES_FOR_LOOP = 2;

export interface SemanticFailureLoopEvidence {
  detected: boolean;
  signature: string;
  semanticFailures: FailureRow[];
}

/**
 * A task is in a semantic failure loop when it has accumulated at least
 * `MIN_SEMANTIC_FAILURES_FOR_LOOP` unresolved failures that are NOT
 * operational (isOperationalFailureReason already distinguishes a real
 * content/logic problem from a transient infra blip — reused as-is, the
 * same classifier office-engineer.ts's own operational-repair path relies
 * on). A single semantic failure is normal and expected sometimes; a
 * repeat is the actual loop this capability exists to break.
 */
export function detectSemanticFailureLoop(db: DatabaseSync, task: TaskRow): SemanticFailureLoopEvidence {
  const failures = listFailuresForTask(db, task.id).filter((f) => !f.resolved);
  const semanticFailures = failures.filter((f) => !isOperationalFailureReason(f.reason));
  if (semanticFailures.length < MIN_SEMANTIC_FAILURES_FOR_LOOP) {
    return { detected: false, signature: "", semanticFailures: [] };
  }
  return {
    detected: true,
    signature: computeFailureSignature(semanticFailures.map((f) => f.reason)),
    semanticFailures,
  };
}

export interface ClassificationEvidence {
  authoritativeUserRequest: string;
  architectureContent: string | null;
  /** A prior "code" artifact, if any — the model's own recorded description of what it already built (not applied to disk, purely documentation, per ArtifactPayload's docblock in providers/types.ts), often more specific than a thin architecture doc. */
  codeArtifactContent: string | null;
  affectedFiles: Array<{ path: string; content: string }>;
  failureReasons: string[];
}

// Two orders, both real: real source code says "class Foo" / "export
// class Foo"; prose (a recorded "code" artifact's own description, or an
// architecture doc) just as often says "Foo class" ("...TaskStore class:
// manages tasks array...", the exact real phrasing that prompted this).
const STRUCTURE_NAME_PATTERNS = [/\b(?:class|interface|struct)\s+([A-Z]\w+)/g, /\b([A-Z]\w+)\s+(?:class|interface|struct)\b/g];

function extractStructureNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const pattern of STRUCTURE_NAME_PATTERNS) {
    for (const match of text.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

/**
 * Deterministic first-pass classifier — no AI call. Reasons about
 * whether a real, specific structural contract (a named class/interface)
 * exists anywhere in the evidence, and if so, whether the architecture
 * artifact itself is the thing that documents it, is silent about it, or
 * actively contradicts it. Genuinely ambiguous evidence classifies as
 * OWNER_CLARIFICATION_REQUIRED rather than guessing — per the brief,
 * "Never silently rewrite architecture just to make generated code
 * pass." A caller may still route to a real AI provider for a deeper
 * diagnosis when this heuristic can't confidently resolve it (see
 * semantic-repair-execution.ts's `runTargetedSemanticDiagnosis`); this
 * function itself never does.
 */
export function classifyMismatch(evidence: ClassificationEvidence): { classification: SemanticRepairClassification; rationale: string; authoritativeContract: string } {
  const architectureNames = evidence.architectureContent ? extractStructureNames(evidence.architectureContent) : new Set<string>();
  const codeArtifactNames = evidence.codeArtifactContent ? extractStructureNames(evidence.codeArtifactContent) : new Set<string>();
  const fileNames = new Set<string>();
  for (const file of evidence.affectedFiles) for (const name of extractStructureNames(file.content)) fileNames.add(name);

  const establishedNames = new Set<string>([...codeArtifactNames, ...fileNames]);

  if (establishedNames.size === 0 && architectureNames.size === 0) {
    return {
      classification: "OWNER_CLARIFICATION_REQUIRED",
      rationale: "No specific structural contract (a named class/interface) could be found in the architecture artifact, the recorded code artifact, or the affected files — there is no clear source of truth to repair against.",
      authoritativeContract: "(none identified)",
    };
  }

  if (establishedNames.size > 0 && architectureNames.size === 0) {
    // The real, working implementation already establishes a specific
    // contract; the architecture artifact never claimed anything
    // different (it's simply silent at this level of detail) — nothing
    // to update in architecture. The rejected proposal(s) are what
    // diverged from an ALREADY-CORRECT implementation.
    const contract = [...establishedNames].join(", ");
    return {
      classification: "IMPLEMENTATION_WRONG",
      rationale: `The affected files/recorded code artifact already establish a specific contract (${contract}) that the architecture artifact does not contradict (it simply doesn't document implementation-level detail). The repeatedly-rejected corrective proposal(s) are what diverged from this already-working contract, not the architecture.`,
      authoritativeContract: contract,
    };
  }

  const overlap = [...establishedNames].filter((n) => architectureNames.has(n));
  if (establishedNames.size > 0 && overlap.length > 0) {
    return {
      classification: "IMPLEMENTATION_WRONG",
      rationale: `The architecture artifact itself documents the contract (${overlap.join(", ")}), and the affected files/code artifact already implement it consistently. The repeatedly-rejected proposal(s) diverged from this documented, authoritative contract.`,
      authoritativeContract: overlap.join(", "),
    };
  }

  if (architectureNames.size > 0 && establishedNames.size > 0 && overlap.length === 0) {
    // Architecture specifies one contract; the real, already-built
    // implementation specifies a different one.
    if (evidence.codeArtifactContent) {
      // A "code" artifact only ever gets recorded as part of a
      // SUCCEEDED run's StructuredAgentOutput (see ArtifactPayload's
      // docblock in providers/types.ts) — its presence is real evidence
      // that a role deliberately, successfully built and recorded this
      // different structure, not just leftover/incidental file content.
      // That tips this toward "the architecture wasn't updated to match
      // a real, working decision" rather than an unresolved conflict.
      return {
        classification: "ARCHITECTURE_STALE",
        rationale: `The architecture artifact still describes an older structure (${[...architectureNames].join(", ")}), but a role has since successfully implemented and recorded a different one (${[...establishedNames].join(", ")}) in the "code" artifact — the architecture was not updated to match a real, working implementation decision.`,
        authoritativeContract: [...establishedNames].join(", "),
      };
    }
    return {
      classification: "BOTH_INCONSISTENT",
      rationale: `The architecture artifact names a different structure (${[...architectureNames].join(", ")}) than the one actually implemented in the affected files (${[...establishedNames].join(", ")}) — these two sources of truth disagree with each other, and no recorded "code" artifact confirms which was a deliberate, successful decision.`,
      authoritativeContract: "(conflicting — see rationale)",
    };
  }

  // architectureNames.size > 0 && establishedNames.size === 0: the
  // architecture specifies a contract that nothing has actually built
  // yet — the architecture is ahead of the implementation, not stale.
  // Deliberately conservative: this shape doesn't match "stale," and
  // guessing further isn't warranted from static evidence alone.
  return {
    classification: "OWNER_CLARIFICATION_REQUIRED",
    rationale: `The architecture artifact names a structure (${[...architectureNames].join(", ")}) that no affected file or recorded code artifact currently implements — evidence is insufficient to determine whether the implementation attempts are simply incomplete or are diverging for a real reason.`,
    authoritativeContract: [...architectureNames].join(", "),
  };
}

/** Assembles the structured repair plan object the brief specifies — persisted before anything is ever touched (see semantic-repair-execution.ts). */
export function buildRepairPlan(evidence: ClassificationEvidence, failureReasons: string[]): RepairPlan {
  const { classification, rationale, authoritativeContract } = classifyMismatch(evidence);
  return {
    classification,
    rootCause: rationale,
    authoritativeContract,
    affectedFiles: evidence.affectedFiles.map((f) => f.path),
    requiredChanges: [
      `Satisfy the exact reported failure: ${failureReasons[failureReasons.length - 1] ?? "(no failure text recorded)"}`,
    ],
    mustPreserve: [
      "The current, already-working behavior of every affected file except where the reported failure genuinely requires a change.",
      authoritativeContract !== "(none identified)" && authoritativeContract !== "(conflicting — see rationale)"
        ? `The established contract: ${authoritativeContract}.`
        : "Whatever structure the affected files already establish.",
      "Do not rename or reinvent established interfaces/classes/modules unless the repair genuinely requires it.",
    ],
    verification: [
      "Re-run this task's normal execution path (the same QA/review pipeline every other attempt goes through) against the repaired files.",
      "The proposed fileOperations must themselves pass the existing retry-drift (intent-consistency) check before being applied.",
    ],
  };
}
