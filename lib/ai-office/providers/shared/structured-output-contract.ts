import "server-only";
import { z } from "zod";
// Relative + extension-explicit — see lib/ai-office/db/client.ts's comment.
import type { AgentTaskInput, AgentTaskResult, StructuredAgentOutput } from "../types.ts";

/**
 * The provider-agnostic structured-output contract and prompt-building
 * logic — factored out of ollama-adapter.ts (controlled Claude LIVE
 * pilot follow-up, Part 15/16) so ClaudeAdapter uses the exact same
 * schema, the exact same authoritative-request/remediation-context
 * prompt sections, and the exact same file-writing/integrity guidance
 * as OllamaAdapter — never a weaker, Claude-specific path. Every
 * provider-independent gate downstream (structured-output validation,
 * workspace path safety, the development deliverable contract,
 * workspace-integrity validation, retry-drift protection, real
 * Playwright QA, intent consistency, code review, release readiness)
 * already only ever looks at this shared `StructuredAgentOutput` shape,
 * never at which provider produced it.
 */

/** Must match the `artifacts.type` CHECK constraint exactly (`lib/ai-office/db/migrations/001-init.sql`) — a model returning any other string is a validation failure (clean FAILED result), never an uncaught SQL error deep inside persistence. */
export const ARTIFACT_TYPES = [
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

export const structuredOutputSchema = z.object({
  summary: z.string(),
  artifacts: z.array(artifactSchema).default([]),
  decisions: z.array(decisionSchema).default([]),
  testResults: z.array(testResultSchema).default([]),
  events: z.array(eventSchema).default([]),
  fileOperations: z.array(fileOperationSchema).default([]),
  recommendedNextActions: z.array(z.string()).default([]),
  failure: z.object({ reason: z.string() }).optional(),
});

/** Roles allowed to request real file writes — a static page's actual implementation work; every other role only ever produces text artifacts, matching their seeded `allowedOutputs`. Provider-independent: applies identically to a local model and to Claude. */
export const FILE_WRITING_ROLES = new Set(["frontend-developer", "backend-developer"]);

/** Each role's one primary output type, matching `AGENT_ROLE_CATALOG`'s `allowedOutputs` — told to the model explicitly so it names an `artifactType` that actually satisfies the DB's CHECK constraint (see `ARTIFACT_TYPES` above), rather than leaving it to guess a synonym. */
export const EXPECTED_ARTIFACT_TYPE: Partial<Record<string, (typeof ARTIFACT_TYPES)[number]>> = {
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
 * this particular project builds, and never anything specific to which
 * provider/model will read it.
 */
export function buildCorrectiveAttemptSection(remediation: NonNullable<AgentTaskInput["task"]["remediationContext"]>): string[] {
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

/**
 * The exact section content every prompt is built from — factored out so
 * `buildPrompt()` (the flat, single-string form every adapter used before
 * the token-economics phase, and the ONLY form OllamaAdapter ever sees)
 * and `buildPromptSegments()` (Claude's system/user split, for prompt
 * caching) are guaranteed to derive from the identical underlying data,
 * never two copies that could quietly drift apart. `buildPrompt()`
 * concatenates these in the exact original order — this refactor changes
 * no character of its output (verified by the existing OllamaAdapter/
 * benchmark test suite, which is byte-sensitive to exact prompt wording).
 */
function buildPromptSections(input: AgentTaskInput) {
  const { task } = input;
  const artifacts = task.relevantArtifacts.map((a) => `- [${a.type}] ${a.content.slice(0, 600)}`).join("\n") || "(none)";
  const decisions = task.relevantDecisions.map((d) => `- [${d.type}] ${d.summary}`).join("\n") || "(none)";
  const relevantFiles = task.relevantFiles ?? [];
  const files = relevantFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
  const expectedArtifactType = EXPECTED_ARTIFACT_TYPE[input.role];

  const roleIntro = [`You are the "${input.role}" role inside an autonomous AI engineering office. Do only this one task; do not attempt any other role's work.`, ""];

  const authoritativeRequest = [
    "===== AUTHORITATIVE USER REQUEST =====",
    "This is the ONLY source of truth for what to build. Everything below this section is organizational metadata, not a specification — never infer what to build from a title, provider name, or model name, even if it happens to mention a technology or tool by name.",
    task.authoritativeUserRequest || "(no idea text was recorded for this project — rely only on the artifacts below)",
    "",
  ];

  const correctiveAttempt = task.remediationContext ? buildCorrectiveAttemptSection(task.remediationContext) : [];

  const metadata = [
    "===== PROJECT METADATA (labels only — not requirements) =====",
    `Project title (an organizational label chosen by the owner, not a product spec): "${task.projectTitle}"`,
    `Your current task's tracking label: "${task.taskTitle}"`,
    `Role instructions: ${input.instructions}`,
    "",
  ];

  const approvedPriorWork = [
    "===== APPROVED PRIOR WORK (already reviewed, builds on the authoritative request above) =====",
    "Relevant prior artifacts:",
    artifacts,
    "",
    "Relevant prior decisions:",
    decisions,
    "",
  ];

  // The corrective-attempt section above already includes the full, real
  // current file contents — repeating the generic (and, for a developer
  // role, normally-empty) relevantFiles block here would just be
  // duplicated context for no benefit.
  const relevantFilesSection =
    relevantFiles.length > 0 && !task.remediationContext
      ? ["Real files currently in the project workspace (for reference/review, not to be echoed back verbatim):", files, ""]
      : [];

  const responseFormat = [
    "Respond with ONLY a single JSON object (no prose, no markdown fences) matching exactly this shape:",
    `{"summary": string, "artifacts": [{"kind":"artifact","artifactType": string,"content": string}], "decisions": [{"kind":"decision","type":"decision"|"assumption","summary": string}], "testResults": [], "events": [], "fileOperations": [], "recommendedNextActions": [string]}`,
    expectedArtifactType
      ? `Every artifact you produce must use exactly "artifactType": "${expectedArtifactType}" — no other value is valid for this role.`
      : "",
    FILE_WRITING_ROLES.has(input.role)
      ? 'Your implementation is not complete unless you emit the required "fileOperations" that create or update the real project workspace: [{"kind":"file-operation","action":"write","path": "relative/file/path","content": "full file content"}] — paths must be relative (no leading slash, no ".."), and content must be the complete file, not a diff or a description of one. Do not place executable source code only inside the "artifacts" field — an artifact may summarize the work in prose, but "fileOperations" is the ONLY mechanism that actually changes the application. A response with no fileOperations will be treated as if no implementation work was done, even if an artifact describes or contains the code. Before returning a successful result: every local file referenced by the files you create (e.g. a script or stylesheet tag) must also exist in the resulting workspace — include all of the fileOperations required to make that true. Do not reference a local file you did not create unless it already exists in the current workspace. Prefer a complete, runnable deliverable over one that merely describes what it would contain.'
      : "",
    'If you cannot complete the task, instead include a top-level "failure": {"reason": string} field.',
  ];

  return { roleIntro, authoritativeRequest, correctiveAttempt, metadata, approvedPriorWork, relevantFilesSection, responseFormat };
}

/** The one prompt-building function every provider adapter uses — identical text regardless of which model/provider will read it. */
export function buildPrompt(input: AgentTaskInput): string {
  const s = buildPromptSections(input);
  return [...s.roleIntro, ...s.authoritativeRequest, ...s.correctiveAttempt, ...s.metadata, ...s.approvedPriorWork, ...s.relevantFilesSection, ...s.responseFormat].join(
    "\n",
  );
}

/**
 * Token economics phase, Part 9 — Claude's system/user split for real
 * Anthropic prompt caching. `systemText` carries only what's genuinely
 * stable ACROSS repeated calls for the same role on the same project (the
 * fixed role contract/response-format instructions, which never change,
 * plus the authoritative user request, which is fixed for the life of a
 * project) — exactly the content a cache breakpoint benefits from, since a
 * project's retries/multiple-role calls repeat it verbatim. `userText`
 * carries everything that legitimately varies call-to-call (corrective-
 * attempt/failure detail, task metadata, prior artifacts/decisions,
 * relevant files) and is never cached. `concisenessInstructions` is
 * additional, paid-provider-only guidance (Part 8) — deliberately never
 * added to `buildPrompt()`'s shared output, so OllamaAdapter's exact
 * prompt text is completely unaffected by this phase (Part 12).
 */
export function buildPromptSegments(input: AgentTaskInput): { systemText: string; userText: string } {
  const s = buildPromptSections(input);
  const concisenessInstructions = [
    "",
    "===== RESPONSE STYLE (required) =====",
    "Be concise. No essays, no restating the requirements back, no chain-of-thought or step-by-step reasoning narration, no unnecessary explanation. \"summary\" must be one or two short sentences. Return only the required StructuredAgentOutput JSON — real implementation work belongs in \"fileOperations\", never described in prose instead of written.",
  ];
  const systemText = [...s.roleIntro, ...s.authoritativeRequest, ...s.responseFormat, ...concisenessInstructions].join("\n");
  const userText = [...s.correctiveAttempt, ...s.metadata, ...s.approvedPriorWork, ...s.relevantFilesSection].join("\n");
  return { systemText, userText };
}

export function malformedResult(reason: string): AgentTaskResult {
  return {
    status: "FAILED",
    output: { summary: "", artifacts: [], decisions: [], testResults: [], events: [], fileOperations: [], recommendedNextActions: [], failure: { reason } },
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    raw: { malformed: true },
  };
}

/**
 * Parses+validates a raw JSON-text model response against the shared
 * schema — the one place both adapters turn "a string of text the model
 * produced" into a real `StructuredAgentOutput`, so a schema-shape bug
 * can never diverge between providers. `reason` is a complete clause
 * ("was not valid JSON" / "did not match the expected structured
 * shape: ...") — callers compose it directly after "Ollama's model
 * output "/"Claude's model output " with no extra wording, since
 * agent-runner.ts's `isOperationalFailureReason()` pattern-matches
 * these exact phrases to classify a failure as operational.
 */
export function parseStructuredOutput(rawJsonText: string): { ok: true; output: StructuredAgentOutput } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch {
    return { ok: false, reason: "was not valid JSON." };
  }
  const validated = structuredOutputSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, reason: `did not match the expected structured shape: ${validated.error.message}` };
  }
  return { ok: true, output: validated.data };
}
