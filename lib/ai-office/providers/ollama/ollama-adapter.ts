import "server-only";
import { z } from "zod";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AIProviderAdapter, AgentTaskInput, AgentTaskResult, CostEstimate, StructuredAgentOutput } from "../types.ts";

/**
 * The local, free provider — a real LLM via a locally-running Ollama
 * server, for testing the actual agent pipeline without spending Claude
 * API money. Implements the same `AIProviderAdapter` interface as
 * `SimulatedAdapter`; nothing outside this module ever makes an HTTP call
 * to Ollama (docs/ai-office/04-agent-architecture.md §4's "adding a
 * provider never touches AgentRunner" still holds).
 *
 * `usage.costUsd` is always 0 — Ollama is local inference, never LIVE
 * spend, and this adapter's usage rows must never enter the LIVE budget
 * ledger (see lib/ai-office/domain/budget.ts's FREE_PROVIDERS exclusion).
 *
 * No shell/exec of any kind happens here or as a result of a model's
 * output — this adapter only does an HTTP POST and JSON parsing; the
 * model produces structured *data*, and existing agent/runner code (this
 * file's only caller) decides what to do with it, identically to how it
 * already treats SimulatedAdapter's fixture output.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma4:latest";
const DEFAULT_TIMEOUT_MS = 120_000;

export class OllamaConnectionError extends Error {}
export class OllamaTimeoutError extends Error {}

/** Must match the `artifacts.type` CHECK constraint exactly (`lib/ai-office/db/migrations/001-init.sql`) — a model returning any other string is a validation failure (clean FAILED result), never an uncaught SQL error deep inside persistence. */
const ARTIFACT_TYPES = [
  "requirements",
  "architecture",
  "ux-spec",
  "code",
  "test-report",
  "security-report",
  "review-notes",
  "release-summary",
  "research-notes",
] as const;

const artifactSchema = z.object({
  kind: z.literal("artifact"),
  artifactType: z.enum(ARTIFACT_TYPES),
  content: z.string(),
  version: z.number().optional(),
});
const decisionSchema = z.object({
  kind: z.literal("decision"),
  type: z.enum(["decision", "assumption"]),
  summary: z.string(),
  rationale: z.string().optional(),
});
const testResultSchema = z.object({
  kind: z.literal("test-result"),
  status: z.enum(["PASS", "FAIL"]),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
const eventSchema = z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()) });
/** Mirrors `FileOperationPayload` (providers/types.ts) exactly — the model may only request "write"/"delete" against a relative path; real path/size safety is enforced later, at materialization time (lib/ai-office/workspace/apply-file-operations.ts), never trusted from this schema alone. */
const fileOperationSchema = z.object({
  kind: z.literal("file-operation"),
  action: z.enum(["write", "delete"]),
  path: z.string().min(1),
  content: z.string().optional(),
});

const structuredOutputSchema = z.object({
  summary: z.string(),
  artifacts: z.array(artifactSchema).default([]),
  decisions: z.array(decisionSchema).default([]),
  testResults: z.array(testResultSchema).default([]),
  events: z.array(eventSchema).default([]),
  fileOperations: z.array(fileOperationSchema).default([]),
  recommendedNextActions: z.array(z.string()).default([]),
  failure: z.object({ reason: z.string() }).optional(),
});

/** Roles allowed to request real file writes — a static page's actual implementation work; every other role only ever produces text artifacts, matching their seeded `allowedOutputs`. */
const FILE_WRITING_ROLES = new Set(["frontend-developer", "backend-developer"]);

/** Each role's one primary output type, matching `AGENT_ROLE_CATALOG`'s `allowedOutputs` — told to the model explicitly so it names an `artifactType` that actually satisfies the DB's CHECK constraint (see `ARTIFACT_TYPES` above), rather than leaving it to guess a synonym. */
const EXPECTED_ARTIFACT_TYPE: Partial<Record<string, (typeof ARTIFACT_TYPES)[number]>> = {
  "product-owner": "requirements",
  "research-agent": "research-notes",
  "solution-architect": "architecture",
  "ui-ux-agent": "ux-spec",
  "frontend-developer": "code",
  "backend-developer": "code",
  "qa-agent": "test-report",
  "security-reviewer": "security-report",
  "code-reviewer": "review-notes",
  "release-agent": "release-summary",
};

/**
 * Renders the "this is a patch, not a redesign" section for a
 * corrective attempt — see RemediationContext's docblock
 * (providers/types.ts) for why this exists. Deliberately generic: every
 * sentence here is fixed guidance text, never anything specific to what
 * this particular project builds.
 */
function buildCorrectiveAttemptSection(remediation: NonNullable<AgentTaskInput["task"]["remediationContext"]>): string[] {
  const failingChecksList = remediation.failingChecks.map((reason) => `- ${reason}`).join("\n") || "(none recorded)";
  const currentFilesText =
    remediation.currentFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n") || "(no files exist in the workspace yet)";

  return [
    "===== CORRECTIVE ATTEMPT — READ BEFORE DOING ANYTHING =====",
    `Attempt: ${remediation.attemptNumber}`,
    "THIS IS A CORRECTIVE ATTEMPT. You are NOT redesigning the application. The authoritative user request above remains unchanged and is still the only definition of what to build.",
    "",
    `Reason this task was reopened: ${remediation.failureReason ?? "(no specific reason recorded)"}`,
    "All currently unresolved issues on this task:",
    failingChecksList,
    "",
    remediation.preserveRequirements,
    "",
    "Current real files in the project workspace — this is what actually exists right now. Preserve everything here that the failure reason above does not implicate:",
    currentFilesText,
    "",
  ];
}

function buildPrompt(input: AgentTaskInput): string {
  const { task } = input;
  const artifacts = task.relevantArtifacts.map((a) => `- [${a.type}] ${a.content.slice(0, 600)}`).join("\n") || "(none)";
  const decisions = task.relevantDecisions.map((d) => `- [${d.type}] ${d.summary}`).join("\n") || "(none)";
  const relevantFiles = task.relevantFiles ?? [];
  const files = relevantFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
  const expectedArtifactType = EXPECTED_ARTIFACT_TYPE[input.role];

  return [
    `You are the "${input.role}" role inside an autonomous AI engineering office. Do only this one task; do not attempt any other role's work.`,
    "",
    "===== AUTHORITATIVE USER REQUEST =====",
    "This is the ONLY source of truth for what to build. Everything below this section is organizational metadata, not a specification — never infer what to build from a title, provider name, or model name, even if it happens to mention a technology or tool by name.",
    task.authoritativeUserRequest || "(no idea text was recorded for this project — rely only on the artifacts below)",
    "",
    ...(task.remediationContext ? buildCorrectiveAttemptSection(task.remediationContext) : []),
    "===== PROJECT METADATA (labels only — not requirements) =====",
    `Project title (an organizational label chosen by the owner, not a product spec): "${task.projectTitle}"`,
    `Your current task's tracking label: "${task.taskTitle}"`,
    `Role instructions: ${input.instructions}`,
    "",
    "===== APPROVED PRIOR WORK (already reviewed, builds on the authoritative request above) =====",
    "Relevant prior artifacts:",
    artifacts,
    "",
    "Relevant prior decisions:",
    decisions,
    "",
    // The corrective-attempt section above already includes the full,
    // real current file contents — repeating the generic (and, for a
    // developer role, normally-empty) relevantFiles block here would
    // just be duplicated context for no benefit.
    ...(relevantFiles.length > 0 && !task.remediationContext
      ? ["Real files currently in the project workspace (for reference/review, not to be echoed back verbatim):", files, ""]
      : []),
    "Respond with ONLY a single JSON object (no prose, no markdown fences) matching exactly this shape:",
    `{"summary": string, "artifacts": [{"kind":"artifact","artifactType": string,"content": string}], "decisions": [{"kind":"decision","type":"decision"|"assumption","summary": string}], "testResults": [], "events": [], "fileOperations": [], "recommendedNextActions": [string]}`,
    expectedArtifactType
      ? `Every artifact you produce must use exactly "artifactType": "${expectedArtifactType}" — no other value is valid for this role.`
      : "",
    FILE_WRITING_ROLES.has(input.role)
      ? 'Your implementation is not complete unless you emit the required "fileOperations" that create or update the real project workspace: [{"kind":"file-operation","action":"write","path": "relative/file/path","content": "full file content"}] — paths must be relative (no leading slash, no ".."), and content must be the complete file, not a diff or a description of one. Do not place executable source code only inside the "artifacts" field — an artifact may summarize the work in prose, but "fileOperations" is the ONLY mechanism that actually changes the application. A response with no fileOperations will be treated as if no implementation work was done, even if an artifact describes or contains the code.'
      : "",
    'If you cannot complete the task, instead include a top-level "failure": {"reason": string} field.',
  ].join("\n");
}

function malformedResult(reason: string): AgentTaskResult {
  return {
    status: "FAILED",
    output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason } },
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    raw: { malformed: true },
  };
}

export interface OllamaAdapterOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** Test-injection point — same pattern as agent-runner.ts's `options.provider`. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class OllamaAdapter implements AIProviderAdapter {
  readonly name = "ollama";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(input: AgentTaskInput): CostEstimate {
    return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
  }

  async runAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const prompt = buildPrompt(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt, stream: false, format: "json" }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OllamaTimeoutError(`Ollama request timed out after ${this.timeoutMs}ms (model "${this.model}" at ${this.baseUrl}).`);
      }
      throw new OllamaConnectionError(
        `Could not reach Ollama at ${this.baseUrl} — is it running? (${error instanceof Error ? error.message : String(error)})`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new OllamaConnectionError(`Ollama responded with HTTP ${response.status} at ${this.baseUrl}.`);
    }

    let body: { response?: string; prompt_eval_count?: number; eval_count?: number };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return malformedResult("Ollama's HTTP response body was not valid JSON.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.response ?? "");
    } catch {
      return malformedResult("Ollama's model output was not valid JSON.");
    }

    const validated = structuredOutputSchema.safeParse(parsed);
    if (!validated.success) {
      return malformedResult(`Ollama's model output did not match the expected structured shape: ${validated.error.message}`);
    }

    const output: StructuredAgentOutput = validated.data;
    return {
      status: output.failure ? "FAILED" : "SUCCEEDED",
      output,
      usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0, costUsd: 0 },
      raw: { model: this.model },
    };
  }
}
