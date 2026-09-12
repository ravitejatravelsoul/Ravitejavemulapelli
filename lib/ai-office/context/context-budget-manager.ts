import "server-only";
import type { DatabaseSync } from "node:sqlite";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AgentRoleRow } from "../domain/agent-roles.ts";
import type { TaskRow } from "../domain/tasks.ts";
import type { AgentTaskInput, TaskContext } from "../providers/types.ts";
import type { ModelCapability } from "../agents/model-router.ts";
import { listWorkspaceFileRecords } from "../domain/workspace.ts";
import { workspaceExists, readFile } from "../workspace/workspace-service.ts";
import { buildPrompt } from "../providers/shared/structured-output-contract.ts";
import { estimateTokens } from "./token-estimate.ts";
import { getCapabilityContextBudget, HARD_MAX_ESTIMATED_INPUT_TOKENS, type CapabilityContextBudget } from "./capability-budgets.ts";
import { selectRelevantFiles, extractLocalReferences, type FileCandidate } from "./relevant-files.ts";

/**
 * Token economics phase — the single centralized component every paid
 * provider call's context must pass through before it is ever sent
 * (Part 1's "one server-side component," never scattered per-agent rules).
 * Reuses `context-builder.ts`'s already-role-scoped `TaskContext` as its
 * *input* (never rebuilds scoping from scratch) and returns either a
 * trimmed `TaskContext` ready to hand to `buildPrompt()`, or a clear
 * BLOCKED verdict — never a runaway prompt sent silently.
 *
 * This module is intentionally provider-agnostic (works from `TaskContext`,
 * not `ClaudeAdapter`), but is only ever invoked for the CLAUDE path
 * (agent-runner.ts's `prepareClaudeCall`) — LOCAL/Ollama calls are
 * deliberately left untouched (Part 12 — "LOCAL calls remain unaffected"),
 * since Ollama inference is free and this entire phase is about paid-call
 * economics.
 */

export interface ContextOptimizationTelemetry {
  capability: ModelCapability;
  estimatedInputTokens: number;
  allowedOutputTokens: number;
  filesSelected: string[];
  filesExcluded: string[];
  sectionsIncluded: string[];
  shrinkStepsApplied: string[];
  blocked: boolean;
  blockReason?: string;
}

export type OptimizeContextResult =
  | { ok: true; context: TaskContext; allowedOutputTokens: number; telemetry: ContextOptimizationTelemetry }
  | { ok: false; telemetry: ContextOptimizationTelemetry };

export interface OptimizeContextInput {
  db: DatabaseSync;
  capability: ModelCapability;
  role: AgentRoleRow;
  task: TaskRow;
  context: TaskContext;
}

function estimateForContext(role: string, instructions: string, context: TaskContext): number {
  const input: AgentTaskInput = { role, instructions, task: context };
  return estimateTokens(buildPrompt(input));
}

/** Deduplicates by rendered content — the cheapest, always-safe first shrink step (Part 6a): two artifacts/decisions that say the same thing cost tokens twice for zero benefit. */
function dedupeByText<T>(items: T[], textOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = textOf(item).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated for context budget)` : text;
}

/** Real workspace files, filtered down to just the relevant subset (Part 5) — used for BOTH `context.relevantFiles` and, for a corrective attempt, `remediationContext.currentFiles` (Part 3's retry-delta context: the whole point is never resending every file on every retry). */
async function selectAndReadFiles(
  db: DatabaseSync,
  projectId: string,
  taskId: string,
  taskTitle: string,
  failingChecks: string[],
  budget: CapabilityContextBudget,
): Promise<{ files: Array<{ path: string; content: string }>; selectedPaths: string[]; excludedPaths: string[] }> {
  if (!workspaceExists(projectId) || budget.maxFiles <= 0) {
    return { files: [], selectedPaths: [], excludedPaths: [] };
  }

  const records = listWorkspaceFileRecords(db, projectId);
  const candidates: FileCandidate[] = records.map((r) => ({ path: r.path, sizeBytes: r.sizeBytes, lastModifiedByTaskId: r.lastModifiedByTaskId }));

  // Leave one slot of headroom for reference-expansion below, so a
  // strongly-scored anchor file's own dependency doesn't get crowded out
  // by the Nth-ranked, otherwise-unrelated file.
  const anchorBudget = Math.max(1, budget.maxFiles - 1);
  const anchors = selectRelevantFiles({ files: candidates, taskId, taskTitle, failingChecks, maxFiles: anchorBudget });

  const selectedSet = new Set(anchors.selectedPaths);
  const excludedSet = new Set(anchors.excludedPaths);
  const files: Array<{ path: string; content: string }> = [];

  for (const path of anchors.selectedPaths) {
    const content = await readFile(projectId, path);
    files.push({ path, content });

    // Part 5's "imports/references where safely detectable" — a selected
    // anchor's own direct local dependencies are pulled in too, up to the
    // remaining budget, so e.g. selecting index.html doesn't leave its
    // referenced script.js silently excluded.
    if (selectedSet.size >= budget.maxFiles) continue;
    for (const ref of extractLocalReferences(content)) {
      if (selectedSet.size >= budget.maxFiles) break;
      if (selectedSet.has(ref) || !excludedSet.has(ref)) continue; // not a real, currently-excluded candidate
      selectedSet.add(ref);
      excludedSet.delete(ref);
    }
  }

  // Read any reference-expanded files that weren't already read as anchors.
  for (const path of selectedSet) {
    if (files.some((f) => f.path === path)) continue;
    files.push({ path, content: await readFile(projectId, path) });
  }

  return { files, selectedPaths: [...selectedSet], excludedPaths: [...excludedSet] };
}

export async function optimizeContextForPaidCall(input: OptimizeContextInput): Promise<OptimizeContextResult> {
  const { db, capability, role, task, context } = input;
  const budget = getCapabilityContextBudget(capability);
  const sectionsIncluded = new Set<string>(["authoritative-request", "provider-contract"]);
  const shrinkStepsApplied: string[] = [];

  // ---- Relevance-based selection (Parts 2, 3, 5) --------------------
  const failingChecks = context.remediationContext?.failingChecks ?? [];
  let selection = await selectAndReadFiles(db, task.projectId, task.id, task.title, failingChecks, budget);

  let workingContext: TaskContext = {
    ...context,
    relevantArtifacts: context.relevantArtifacts.slice(0, budget.maxArtifacts),
    relevantDecisions: dedupeByText(context.relevantDecisions, (d) => d.summary).slice(0, budget.maxDecisions),
    // `selection.files` is driven entirely by `budget.maxFiles` — 0 for a
    // capability with no legitimate reason to see file content, matching
    // (and replacing) context-builder.ts's own `allowedInputs.includes
    // ("code")` gate, just capability-scoped instead of role-scoped.
    relevantFiles: selection.files,
    remediationContext: context.remediationContext
      ? {
          ...context.remediationContext,
          // Retry-delta context (Part 3): never resend the whole
          // workspace on a retry — only the files relevance-selection
          // actually kept.
          currentFiles: selection.files,
        }
      : undefined,
  };

  if (context.relevantArtifacts.length > 0) sectionsIncluded.add("approved-artifacts");
  if (context.relevantDecisions.length > 0) sectionsIncluded.add("decisions");
  if (context.remediationContext) sectionsIncluded.add("remediation");
  if (selection.files.length > 0) sectionsIncluded.add("relevant-files");
  if (context.projectSummary) sectionsIncluded.add("compact-project-memory");

  let estimatedInputTokens = estimateForContext(role.id, `Perform your assigned "${role.name}" responsibilities for this task.`, workingContext);

  // ---- Shrink order (Part 6) -----------------------------------------
  // a. Deduplicate history — already applied above (dedupeByText), counted
  //    here only if it actually removed something worth recording.
  if (workingContext.relevantDecisions.length < context.relevantDecisions.length) {
    shrinkStepsApplied.push("deduplicated repeated decisions/history");
  }

  // b. Trim older decisions further once still over budget.
  if (estimatedInputTokens > budget.maxEstimatedInputTokens && workingContext.relevantDecisions.length > 3) {
    workingContext = { ...workingContext, relevantDecisions: workingContext.relevantDecisions.slice(-3) };
    shrinkStepsApplied.push("trimmed to the 3 most recent decisions");
    estimatedInputTokens = estimateForContext(role.id, `Perform your assigned "${role.name}" responsibilities for this task.`, workingContext);
  }

  // c. Prefer summaries over raw artifact content.
  if (estimatedInputTokens > budget.maxEstimatedInputTokens && workingContext.relevantArtifacts.some((a) => a.content.length > 800)) {
    workingContext = { ...workingContext, relevantArtifacts: workingContext.relevantArtifacts.map((a) => ({ ...a, content: truncate(a.content, 800) })) };
    shrinkStepsApplied.push("summarized (truncated) oversized artifacts");
    estimatedInputTokens = estimateForContext(role.id, `Perform your assigned "${role.name}" responsibilities for this task.`, workingContext);
  }

  // d. Exclude further unrelated files — halve the file budget and re-select.
  if (estimatedInputTokens > budget.maxEstimatedInputTokens && (workingContext.relevantFiles?.length ?? 0) > 1) {
    const tighterBudget: CapabilityContextBudget = { ...budget, maxFiles: Math.max(1, Math.floor(budget.maxFiles / 2)) };
    selection = await selectAndReadFiles(db, task.projectId, task.id, task.title, failingChecks, tighterBudget);
    workingContext = {
      ...workingContext,
      relevantFiles: selection.files,
      remediationContext: workingContext.remediationContext ? { ...workingContext.remediationContext, currentFiles: selection.files } : undefined,
    };
    shrinkStepsApplied.push(`reduced included files to the ${tighterBudget.maxFiles} most relevant`);
    estimatedInputTokens = estimateForContext(role.id, `Perform your assigned "${role.name}" responsibilities for this task.`, workingContext);
  }

  // e. Trim oversized file excerpts — last resort, and never for the file a
  //    reported failure names explicitly (that file must stay whole for
  //    correctness — Part 12's "never remove critical context").
  if (estimatedInputTokens > budget.maxEstimatedInputTokens && budget.maxTokensPerFile > 0) {
    const lowerFailures = failingChecks.map((f) => f.toLowerCase());
    const isCritical = (path: string) => lowerFailures.some((f) => f.includes(path.toLowerCase()));
    const trimFiles = (files?: Array<{ path: string; content: string }>) =>
      files?.map((f) => (isCritical(f.path) ? f : { ...f, content: truncate(f.content, budget.maxTokensPerFile * 4) }));
    const trimmedRelevant = trimFiles(workingContext.relevantFiles);
    const trimmedCurrent = workingContext.remediationContext ? trimFiles(workingContext.remediationContext.currentFiles) : undefined;
    if (trimmedRelevant || trimmedCurrent) {
      workingContext = {
        ...workingContext,
        relevantFiles: trimmedRelevant ?? workingContext.relevantFiles,
        remediationContext: workingContext.remediationContext && trimmedCurrent ? { ...workingContext.remediationContext, currentFiles: trimmedCurrent } : workingContext.remediationContext,
      };
      shrinkStepsApplied.push("trimmed oversized file excerpts (excluding any file the reported failure names directly)");
      estimatedInputTokens = estimateForContext(role.id, `Perform your assigned "${role.name}" responsibilities for this task.`, workingContext);
    }
  }

  const telemetryBase = {
    capability,
    estimatedInputTokens,
    allowedOutputTokens: budget.maxOutputTokens,
    filesSelected: selection.selectedPaths,
    filesExcluded: selection.excludedPaths,
    sectionsIncluded: [...sectionsIncluded],
    shrinkStepsApplied,
  };

  // ---- Hard limit (Part 6's final rule) -------------------------------
  if (estimatedInputTokens > HARD_MAX_ESTIMATED_INPUT_TOKENS) {
    return {
      ok: false,
      telemetry: {
        ...telemetryBase,
        blocked: true,
        blockReason: `Context still estimated at ${estimatedInputTokens} tokens after shrinking — over the hard limit of ${HARD_MAX_ESTIMATED_INPUT_TOKENS}. Refusing to send a runaway prompt.`,
      },
    };
  }

  return {
    ok: true,
    context: workingContext,
    allowedOutputTokens: budget.maxOutputTokens,
    telemetry: { ...telemetryBase, blocked: false },
  };
}
