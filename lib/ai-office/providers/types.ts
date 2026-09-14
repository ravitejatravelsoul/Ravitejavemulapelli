import "server-only";

/**
 * The AI Provider Interface — docs/ai-office/04-agent-architecture.md
 * §4. `SimulatedAdapter` (Phase 4) and a future `ClaudeAdapter`
 * (Phase 7+) both implement this identically; adding a provider never
 * touches AgentRunner. No provider adapter is imported by anything
 * outside lib/ai-office/agents/agent-runner.ts — see
 * docs/ai-office/09-budget-and-cost-controls.md §2.
 *
 * `AgentTaskResult.output` is a deliberate, documented refinement of the
 * planning doc's sketch (`ArtifactPayload | TestResultPayload |
 * DecisionPayload`) into one `StructuredAgentOutput` shape that can
 * bundle several of these at once — a single role's output routinely
 * needs to produce an artifact *and* record a decision in the same run
 * (e.g. the Architect), which a bare union couldn't express. See the
 * Phase 4 status note in docs/ai-office/11-implementation-phases.md.
 */

export type AgentRoleId = string;

/** The scoped slice of project memory a role is allowed to see — built by lib/ai-office/agents/context-builder.ts from that role's `allowedInputs`, never the whole project. */
export interface TaskContext {
  projectId: string;
  taskId: string;
  roleId: AgentRoleId;
  taskTitle: string;
  projectSummary: string;
  /**
   * The original, unedited idea text the owner submitted when the project
   * was created — present for EVERY role unconditionally, never gated by
   * `allowedInputs`. This is the one thing every role's work ultimately
   * serves, so scoping it away (the way artifacts/decisions/files are
   * scoped) would be exactly backwards. Always authoritative: a project
   * title, provider name, or model name is organizational metadata only
   * and must never be read as redefining what to build, even when it
   * happens to mention a technology or tool by name. Empty string only if
   * the project genuinely has no recorded idea (should not happen in
   * practice — projects are always created with one).
   */
  authoritativeUserRequest: string;
  /** The project's own organizational title — a label for tracking/display only, never a product specification. A title like "Ollama Hello World Build" describes which provider/test this project is, not that the deliverable should be about Ollama. */
  projectTitle: string;
  relevantArtifacts: Array<{ type: string; content: string }>;
  relevantDecisions: Array<{ type: string; summary: string }>;
  /**
   * A capped, scoped subset of the project's real workspace files —
   * populated only for a role whose `allowedInputs` includes "code"
   * (security-reviewer, code-reviewer, qa-agent) when a real workspace
   * exists, never the whole workspace blindly (Phase 8 Part J). Empty for
   * every other role and for legacy/pure-text projects with no workspace.
   */
  relevantFiles?: Array<{ path: string; content: string }>;
  /**
   * Explicit, deterministic scenario selector for `SimulatedAdapter` —
   * never random. Omitted (or "success") is the default happy path.
   * Real providers (Phase 7+) ignore this field entirely.
   */
  scenario?: string;
  /**
   * Present only when this execution is a corrective attempt (attempt
   * number > 1 for a development role) — built from the SAME
   * Failure/TaskAttempt/workspace data every other remediation path
   * already persists, never a new retry-tracking mechanism. Real
   * acceptance evidence showed that a bare "you failed, try again"
   * signal caused a real model to redesign the whole product while
   * "fixing" an unrelated bug (see intent-consistency.ts's docblock for
   * the fuller incident writeup) — this exists so a retry can instead be
   * told exactly what's broken, what already exists and must be kept,
   * and that this is a patch, not a redesign.
   */
  remediationContext?: RemediationContext;
}

export interface RemediationContext {
  /** This role's own attempt count for this task — 2 on the first retry, etc. Always > 1 whenever this field is present. */
  attemptNumber: number;
  /** The most recent unresolved failure reason for this exact task, if any — verbatim, so the model sees precisely what was reported, not a paraphrase. */
  failureReason: string | null;
  /** Every unresolved failure reason currently on record for this task, oldest first — usually one entry, but a task can accumulate more than one before it's next attempted. */
  failingChecks: string[];
  /** The real, current content of every file already in the project's workspace — not just this role's own prior files — so a corrective attempt can see exactly what exists and preserve whatever isn't the reported problem, rather than reinventing it from scratch. */
  currentFiles: Array<{ path: string; content: string }>;
  /** Fixed, idea-independent guidance — never mentions this project's specific product, on purpose. */
  preserveRequirements: string;
}

export interface AgentTaskInput {
  role: AgentRoleId;
  task: TaskContext;
  instructions: string;
  /** Token economics phase, Part 7 — the capability-specific output ceiling the Context Budget Manager computed for this call (`lib/ai-office/context/capability-budgets.ts`). Ollama ignores it (LOCAL calls are unaffected by this phase); undefined lets an adapter fall back to its own default. */
  maxOutputTokens?: number;
}

/**
 * Documentation, not execution — the human-readable record of what a
 * role did (requirements, an architecture writeup, code shown for
 * review, a summary). Never applied to the filesystem, and never parsed
 * for code by any part of this codebase, deliberately: auto-extracting
 * "code" out of free-form artifact text would be dangerous and
 * ambiguous (no reliable way to know where a snippet begins/ends, what
 * file it belongs in, or whether it's illustrative rather than
 * literal). `FileOperationPayload.fileOperations` below is the ONLY
 * authoritative mechanism for actually changing the real project
 * workspace — a development role's artifact may *describe or contain*
 * real code, but agent-runner.ts's development-deliverable contract
 * (see `isImplementationIntentTask` in agents/agent-runner.ts) treats a
 * SUCCEEDED implementation task with zero fileOperations as a semantic
 * failure regardless of what its artifacts say, because text describing
 * code is not equivalent to creating code.
 */
export interface ArtifactPayload {
  kind: "artifact";
  artifactType: string;
  content: string;
  /** Defaults to 1 if omitted — set explicitly by a fixture/adapter when a run is producing a revised version of a prior artifact (e.g. a fix). */
  version?: number;
}

export interface TestResultPayload {
  kind: "test-result";
  status: "PASS" | "FAIL";
  summary: string;
  details?: Record<string, unknown>;
  /** Populated only by a real (non-fixture) verification — e.g. agent-runner.ts's real Playwright QA override (Phase 8 Part H). Absent for ordinary fixture/model-reported test results. */
  durationMs?: number;
  targetUrl?: string;
}

export interface DecisionPayload {
  kind: "decision";
  type: "decision" | "assumption";
  summary: string;
  rationale?: string;
}

export interface EventPayload {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * A real file change to apply to the project's isolated development
 * workspace (Phase 8) — never executed directly by a provider adapter;
 * `lib/ai-office/workspace/apply-file-operations.ts` is the only thing
 * that turns this into an actual filesystem write, and only after
 * validating every operation in the batch against
 * `lib/ai-office/workspace/workspace-service.ts`'s path/size safety
 * rules. `path` is relative to the project's own workspace root —
 * never an absolute path, never containing "..".
 */
export interface FileOperationPayload {
  kind: "file-operation";
  action: "write" | "delete";
  path: string;
  /** Required for "write" (validated at the applying end, not by this type alone); absent/ignored for "delete". */
  content?: string;
}

/** Provider-neutral structured result — every field is optional/empty-array by default so a minimal adapter response is still valid. */
export interface StructuredAgentOutput {
  summary: string;
  artifacts: ArtifactPayload[];
  decisions: DecisionPayload[];
  testResults: TestResultPayload[];
  events: EventPayload[];
  fileOperations: FileOperationPayload[];
  recommendedNextActions: string[];
  /** Present only when status is "FAILED". */
  failure?: {
    reason: string;
  };
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Real Anthropic prompt-cache token counts (token economics phase, Part 9) — undefined for every non-caching call (Ollama, Simulated, or a Claude call the API didn't report cache usage for). Never fabricated. */
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface AgentTaskResult {
  output: StructuredAgentOutput;
  status: "SUCCEEDED" | "FAILED";
  usage: UsageInfo;
  /** Provider-specific raw response, for debugging only — SimulatedAdapter echoes back the fixture key used. */
  raw?: unknown;
}

export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface AIProviderAdapter {
  readonly name: string; // "simulated" | "claude" | ...
  /** The specific model this adapter instance is bound to (e.g. "gemma4:latest") — undefined for adapters with no model concept, such as SimulatedAdapter. */
  readonly model?: string;
  runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  estimateCost(input: AgentTaskInput): CostEstimate;
}
