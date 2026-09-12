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
  relevantArtifacts: Array<{ type: string; content: string }>;
  relevantDecisions: Array<{ type: string; summary: string }>;
  /**
   * Explicit, deterministic scenario selector for `SimulatedAdapter` —
   * never random. Omitted (or "success") is the default happy path.
   * Real providers (Phase 7+) ignore this field entirely.
   */
  scenario?: string;
}

export interface AgentTaskInput {
  role: AgentRoleId;
  task: TaskContext;
  instructions: string;
}

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
  runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  estimateCost(input: AgentTaskInput): CostEstimate;
}
