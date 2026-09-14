import "server-only";
import type { AgentTaskInput, AgentTaskResult, TaskContext } from "../providers/types.ts";
import { PRESERVE_REQUIREMENTS_GUIDANCE } from "../agents/context-builder.ts";

/**
 * Local model benchmark scenarios (local multi-model routing follow-up,
 * Parts G/H) — deterministic, bounded, single-call micro-benchmarks, one
 * per role capability this office actually routes. Diagnostic only: a
 * scenario calls an adapter directly with a synthetic, throwaway
 * TaskContext (fixed "benchmark" project/task ids) — it never touches a
 * real project, workspace, or the task/attempt/agent_run state machine.
 * Deliberately simple, transparent scoring (PASS/PARTIAL/FAIL bands, not
 * a fine-grained model) — Part J is explicit this is not meant to be
 * "scientifically perfect"; raw evidence (the `details` blob persisted
 * alongside every score) matters more than the number.
 */

export type BenchmarkScenarioId =
  | "product-owner-basic"
  | "architect-static-page"
  | "frontend-build"
  | "frontend-bug-fix"
  | "code-review"
  | "qa-interpretation";

export type BenchmarkStatus = "PASS" | "PARTIAL" | "FAIL";

export interface BenchmarkEvaluation {
  status: BenchmarkStatus;
  score: number;
  notes: string;
  fileOperationValid?: boolean;
  defectDiagnosed?: boolean;
  matchesRequest?: boolean;
}

export interface BenchmarkScenario {
  id: BenchmarkScenarioId;
  roleId: string;
  title: string;
  buildInput: () => AgentTaskInput;
  evaluate: (result: AgentTaskResult) => BenchmarkEvaluation;
}

const SCORE_BY_STATUS: Record<BenchmarkStatus, number> = { PASS: 90, PARTIAL: 50, FAIL: 10 };

function baseContext(overrides: Partial<TaskContext> & Pick<TaskContext, "roleId" | "taskTitle">): TaskContext {
  return {
    projectId: "benchmark",
    taskId: `benchmark-${overrides.roleId}`,
    projectSummary: "",
    authoritativeUserRequest: "",
    projectTitle: "Local Model Benchmark",
    relevantArtifacts: [],
    relevantDecisions: [],
    ...overrides,
  };
}

/** Any adapter-level failure (timeout/connection/malformed JSON/parse error) is always FAIL regardless of scenario-specific scoring — a model that couldn't even respond validly gets no partial credit. */
function structuralFailureEvaluation(result: AgentTaskResult): BenchmarkEvaluation | null {
  if (result.status !== "FAILED") return null;
  return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: `Adapter-level failure: ${result.output.failure?.reason ?? "unknown"}` };
}

const BACKEND_LEAK_SIGNALS = /\b(database|rest api|backend service|server-side|authentication|microservice|sql|node\.?js server|express)\b/i;

const HELLO_WORLD_REQUEST = "Create a simple Hello World webpage with a heading, description and a button.";

/**
 * Output-channel compliance (local multi-model routing follow-up, Part
 * 8) — a model can produce genuinely correct-looking markup while still
 * failing the actual task, because it placed that content in `artifacts`
 * (documentation) instead of `fileOperations` (execution); see
 * `ArtifactPayload`'s docblock in providers/types.ts for the full
 * contract. This is exactly the real acceptance-run failure mode: a
 * model must never receive a coding PASS for writing correct code into
 * the wrong channel, but it's also meaningfully different from producing
 * no usable content at all, so it's scored as its own recognizable
 * PARTIAL rather than collapsed into an undifferentiated FAIL.
 */
function looksLikeRealCode(text: string): boolean {
  return /<html[\s>]/i.test(text) || (/<h1[\s>]/i.test(text) && /<button[\s>]/i.test(text));
}

const productOwnerBasic: BenchmarkScenario = {
  id: "product-owner-basic",
  roleId: "product-owner",
  title: "Product Owner — turn a simple idea into requirements",
  buildInput: () => ({
    role: "product-owner",
    task: baseContext({ roleId: "product-owner", taskTitle: "Write requirements", authoritativeUserRequest: HELLO_WORLD_REQUEST }),
    instructions: 'Perform your assigned "Product Owner" responsibilities for this task.',
  }),
  evaluate: (result) => {
    const structural = structuralFailureEvaluation(result);
    if (structural) return structural;

    const text = [result.output.summary, ...result.output.artifacts.map((a) => a.content)].join("\n").toLowerCase();
    const mentionsCore = ["heading", "description", "button"].every((kw) => text.includes(kw));
    const drifted = BACKEND_LEAK_SIGNALS.test(text);
    if (mentionsCore && !drifted) return { status: "PASS", score: SCORE_BY_STATUS.PASS, notes: "Requirements cover heading/description/button, no drift.", matchesRequest: true };
    if (drifted) return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: "Requirements drifted toward an unrequested backend/service concept.", matchesRequest: false };
    return { status: "PARTIAL", score: SCORE_BY_STATUS.PARTIAL, notes: "Produced requirements, but didn't clearly cover all three requested elements.", matchesRequest: false };
  },
};

const architectStaticPage: BenchmarkScenario = {
  id: "architect-static-page",
  roleId: "solution-architect",
  title: "Architect — plan a static webpage without inventing a backend",
  buildInput: () => ({
    role: "solution-architect",
    task: baseContext({
      roleId: "solution-architect",
      taskTitle: "Design architecture",
      authoritativeUserRequest: HELLO_WORLD_REQUEST,
      relevantArtifacts: [{ type: "requirements", content: "A single static page with a heading, a short description, and a button that changes visible text on click." }],
    }),
    instructions: 'Perform your assigned "Solution Architect" responsibilities for this task.',
  }),
  evaluate: (result) => {
    const structural = structuralFailureEvaluation(result);
    if (structural) return structural;

    const text = [result.output.summary, ...result.output.artifacts.map((a) => a.content)].join("\n").toLowerCase();
    const leaksBackend = BACKEND_LEAK_SIGNALS.test(text);
    const mentionsStatic = /\b(static|html|client-side|frontend only|no backend)\b/i.test(text);
    if (!leaksBackend && mentionsStatic) return { status: "PASS", score: SCORE_BY_STATUS.PASS, notes: "Plans a static/frontend-only page, no backend invented." };
    if (leaksBackend) return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: "Invented backend/server concepts for a static page.", matchesRequest: false };
    return { status: "PARTIAL", score: SCORE_BY_STATUS.PARTIAL, notes: "No backend leak, but didn't clearly state a static/frontend-only architecture." };
  },
};

const frontendBuild: BenchmarkScenario = {
  id: "frontend-build",
  roleId: "frontend-developer",
  title: "Frontend Developer — build the Hello World page",
  buildInput: () => ({
    role: "frontend-developer",
    task: baseContext({
      roleId: "frontend-developer",
      taskTitle: "Implement frontend",
      authoritativeUserRequest: HELLO_WORLD_REQUEST,
      relevantArtifacts: [
        { type: "requirements", content: "A single static page with a heading, a short description, and a button that changes visible text on click." },
        { type: "architecture", content: "Plain static index.html + styles.css + script.js. No backend." },
      ],
    }),
    instructions: 'Perform your assigned "Frontend Developer" responsibilities for this task.',
  }),
  evaluate: (result) => {
    const structural = structuralFailureEvaluation(result);
    if (structural) return structural;

    const ops = result.output.fileOperations;
    const fileOperationValid = ops.length > 0 && ops.every((op) => typeof op.path === "string" && op.path.length > 0);
    const html = ops.find((op) => op.path.toLowerCase().endsWith("index.html"));
    const htmlContent = html?.content ?? "";
    const hasHeading = /<h1[\s>]/i.test(htmlContent);
    const hasButton = /<button[\s>]/i.test(htmlContent);
    const referencesScript = /<script[^>]*src=["']?script\.js/i.test(htmlContent);

    if (fileOperationValid && hasHeading && hasButton && referencesScript) {
      return { status: "PASS", score: SCORE_BY_STATUS.PASS, notes: "Produced valid file operations with heading, button, and linked script.", fileOperationValid: true, matchesRequest: true };
    }
    if (fileOperationValid && (hasHeading || hasButton)) {
      return { status: "PARTIAL", score: SCORE_BY_STATUS.PARTIAL, notes: "Produced file operations but missing one of heading/button/script linkage.", fileOperationValid: true, matchesRequest: false };
    }
    if (ops.length === 0 && looksLikeRealCode(result.output.artifacts.map((a) => a.content).join("\n"))) {
      return {
        status: "PARTIAL",
        score: SCORE_BY_STATUS.PARTIAL,
        notes: "Correct code content, wrong structured output channel — real-looking markup was placed in artifacts instead of fileOperations, so nothing was actually materialized. Must never receive a coding PASS.",
        fileOperationValid: false,
        matchesRequest: false,
      };
    }
    return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: "No valid index.html file operation with the requested elements.", fileOperationValid, matchesRequest: false };
  },
};

const BUGGY_INDEX_HTML = `<!doctype html>
<html>
<head><title>Hello World</title><link rel="stylesheet" href="styles.css"></head>
<body>
  <h1>Hello, World!</h1>
  <p id="message">Welcome.</p>
  <button id="changeBtn">Click me</button>
</body>
</html>
`;
const WORKING_SCRIPT_JS = `document.getElementById("changeBtn").addEventListener("click", () => {
  document.getElementById("message").textContent = "Clicked!";
});
`;

const frontendBugFix: BenchmarkScenario = {
  id: "frontend-bug-fix",
  roleId: "frontend-developer",
  title: "Frontend Bug Fix — diagnose a missing <script> linkage",
  buildInput: () => ({
    role: "frontend-developer",
    task: baseContext({
      roleId: "frontend-developer",
      taskTitle: "Fix reported bug",
      authoritativeUserRequest: HELLO_WORLD_REQUEST,
      remediationContext: {
        attemptNumber: 2,
        failureReason: "Clicking the button does not change the visible text.",
        failingChecks: ["Clicking the button does not change the visible text."],
        currentFiles: [
          { path: "index.html", content: BUGGY_INDEX_HTML },
          { path: "script.js", content: WORKING_SCRIPT_JS },
        ],
        preserveRequirements: PRESERVE_REQUIREMENTS_GUIDANCE,
      },
    }),
    instructions: 'Perform your assigned "Frontend Developer" responsibilities for this task.',
  }),
  evaluate: (result) => {
    const structural = structuralFailureEvaluation(result);
    if (structural) return structural;

    const ops = result.output.fileOperations;
    const fileOperationValid = ops.length > 0;
    const html = ops.find((op) => op.path.toLowerCase().endsWith("index.html"));
    const htmlContent = html?.content ?? "";
    const linksScript = /<script[^>]*src=["']?script\.js/i.test(htmlContent);
    const preservedHeading = /Hello,?\s*World/i.test(htmlContent) || ops.length === 0;

    if (linksScript && fileOperationValid && preservedHeading) {
      return { status: "PASS", score: SCORE_BY_STATUS.PASS, notes: "Correctly diagnosed the missing <script> tag and preserved existing content.", fileOperationValid: true, defectDiagnosed: true, matchesRequest: true };
    }
    if (fileOperationValid && !linksScript) {
      return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: "Made a change but did not add the missing <script src=\"script.js\"> linkage — the actual reported defect.", fileOperationValid: true, defectDiagnosed: false };
    }
    if (ops.length === 0 && looksLikeRealCode(result.output.artifacts.map((a) => a.content).join("\n"))) {
      return {
        status: "PARTIAL",
        score: SCORE_BY_STATUS.PARTIAL,
        notes: "Correct code content, wrong structured output channel — the fix was described/shown in artifacts but never emitted as a fileOperation, so nothing was actually materialized.",
        fileOperationValid: false,
        defectDiagnosed: false,
      };
    }
    return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: "No file operation addressing the reported bug.", fileOperationValid, defectDiagnosed: false };
  },
};

const REVIEW_FILE_WITH_BUG = `document.getElementById("changeBtn").addEventListener("click", () => {
  document.getElementById("outptu").textContent = "Clicked!";
});
`;

const codeReview: BenchmarkScenario = {
  id: "code-review",
  roleId: "code-reviewer",
  title: "Code Review — spot a deliberate element-id typo",
  buildInput: () => ({
    role: "code-reviewer",
    task: baseContext({
      roleId: "code-reviewer",
      taskTitle: "Review code",
      authoritativeUserRequest: HELLO_WORLD_REQUEST,
      relevantFiles: [
        { path: "index.html", content: BUGGY_INDEX_HTML },
        { path: "script.js", content: REVIEW_FILE_WITH_BUG },
      ],
    }),
    instructions: 'Perform your assigned "Code Reviewer" responsibilities for this task.',
  }),
  evaluate: (result) => {
    const structural = structuralFailureEvaluation(result);
    if (structural) return structural;

    const text = [
      result.output.summary,
      ...result.output.artifacts.map((a) => a.content),
      ...result.output.decisions.map((d) => `${d.summary} ${d.rationale ?? ""}`),
      ...result.output.testResults.map((t) => `${t.summary}`),
    ]
      .join("\n")
      .toLowerCase();

    const namedTheTypo = text.includes("outptu");
    const describedTheMismatch = /(mismatch|incorrect id|wrong id|typo|does not match|doesn't match)/i.test(text);

    if (namedTheTypo || describedTheMismatch) {
      return { status: "PASS", score: SCORE_BY_STATUS.PASS, notes: "Identified the element-id mismatch.", defectDiagnosed: true };
    }
    return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: "Did not identify the deliberate element-id typo (\"outptu\").", defectDiagnosed: false };
  },
};

const qaInterpretation: BenchmarkScenario = {
  id: "qa-interpretation",
  roleId: "qa-agent",
  title: "QA Interpretation — turn a real QA failure into remediation guidance",
  buildInput: () => ({
    role: "qa-agent",
    task: baseContext({
      roleId: "qa-agent",
      taskTitle: "Interpret QA failure",
      authoritativeUserRequest: HELLO_WORLD_REQUEST,
      relevantFiles: [
        { path: "index.html", content: BUGGY_INDEX_HTML },
        { path: "script.js", content: WORKING_SCRIPT_JS },
      ],
      relevantArtifacts: [
        {
          type: "test-result",
          content:
            "Real browser QA FAILED: clicking the button did not change the visible message text — expected the #message element's text to update, but it remained unchanged. No console errors were reported.",
        },
      ],
    }),
    instructions: 'Perform your assigned "QA/Test Agent" responsibilities for this task.',
  }),
  evaluate: (result) => {
    const structural = structuralFailureEvaluation(result);
    if (structural) return structural;

    const text = [result.output.summary, ...result.output.recommendedNextActions].join("\n").toLowerCase();
    const mentionsRelevantFix = /(script|button|click|element|id|link|tag)/.test(text);
    const hasFailingTestResult = result.output.testResults.some((t) => t.status === "FAIL") || result.output.recommendedNextActions.length > 0;

    if (mentionsRelevantFix && hasFailingTestResult) {
      return { status: "PASS", score: SCORE_BY_STATUS.PASS, notes: "Produced relevant remediation guidance for the reported QA failure." };
    }
    if (hasFailingTestResult) {
      return { status: "PARTIAL", score: SCORE_BY_STATUS.PARTIAL, notes: "Acknowledged the failure but guidance wasn't clearly relevant." };
    }
    return { status: "FAIL", score: SCORE_BY_STATUS.FAIL, notes: "Did not produce actionable remediation guidance for the reported QA failure." };
  },
};

export const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = [
  productOwnerBasic,
  architectStaticPage,
  frontendBuild,
  frontendBugFix,
  codeReview,
  qaInterpretation,
];

export function getBenchmarkScenario(id: BenchmarkScenarioId): BenchmarkScenario {
  const scenario = BENCHMARK_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Unknown benchmark scenario: "${id}".`);
  return scenario;
}
