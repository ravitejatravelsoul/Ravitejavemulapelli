import "server-only";
// Relative + extension-explicit — required for plain `node --test`
// resolution (see the equivalent comment in lib/ai-office/db/client.ts).
import type { AgentTaskInput, AgentTaskResult, TaskContext } from "../types.ts";

/**
 * Deterministic fixture library — one entry per role, keyed by an
 * explicit scenario string (never random; see
 * docs/ai-office/10-testing-strategy.md §2.9 and the "Simulation
 * behavior must be selected explicitly" requirement). Every role has
 * `success` and `failure`; the two developer roles additionally have
 * `retry-success` (used for the fix attempt after a QA failure — the
 * content differs slightly to make the "this is a fix, not the first
 * attempt" distinction visible in artifact content, not just status).
 *
 * Content is realistic-but-small simulated text — never real
 * application source code, never a real credential/secret of any kind.
 */

const SUCCESS = "success";
const FAILURE = "failure";
const RETRY_SUCCESS = "retry-success";

type Fixture = (input: AgentTaskInput) => AgentTaskResult;

function usage(inputTokens: number, outputTokens: number): AgentTaskResult["usage"] {
  return { inputTokens, outputTokens, costUsd: 0 };
}

function succeed(
  ctx: TaskContext,
  partial: Omit<AgentTaskResult["output"], "events" | "recommendedNextActions"> &
    Partial<Pick<AgentTaskResult["output"], "events" | "recommendedNextActions">>,
): AgentTaskResult {
  return {
    status: "SUCCEEDED",
    output: {
      events: [],
      recommendedNextActions: [],
      ...partial,
    },
    usage: usage(120, 180),
    raw: { fixtureRole: ctx.roleId, scenario: ctx.scenario ?? SUCCESS },
  };
}

function fail(ctx: TaskContext, reason: string, extra?: Partial<AgentTaskResult["output"]>): AgentTaskResult {
  return {
    status: "FAILED",
    output: {
      summary: `Attempt failed: ${reason}`,
      artifacts: [],
      decisions: [],
      testResults: [],
      events: [],
      recommendedNextActions: [],
      failure: { reason },
      ...extra,
    },
    usage: usage(90, 40),
    raw: { fixtureRole: ctx.roleId, scenario: ctx.scenario ?? FAILURE },
  };
}

const orchestrator: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: `Assessed "${task.taskTitle}" and selected the roles required for this idea.`,
      artifacts: [],
      decisions: [
        {
          kind: "decision",
          type: "decision",
          summary: "Selected the role set required for this idea based on the complexity heuristics.",
        },
      ],
      testResults: [],
      recommendedNextActions: ["Proceed to Product Owner for requirements"],
    }),
  [FAILURE]: ({ task }) => fail(task, "idea is too ambiguous to select a safe role set"),
};

const productOwner: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "Drafted requirements and acceptance criteria from the submitted idea.",
      artifacts: [
        {
          kind: "artifact",
          artifactType: "requirements",
          content: [
            "# Requirements",
            "",
            "## Goal",
            `Deliver: ${task.taskTitle}.`,
            "",
            "## Acceptance Criteria",
            "- A tester can capture a screenshot.",
            "- Captured screenshots are compiled into a report.",
            "- The report is exportable in a shareable format.",
          ].join("\n"),
        },
      ],
      decisions: [
        {
          kind: "decision",
          type: "assumption",
          summary: "Assumed a lightweight internal tool, not a public-facing product.",
          rationale: "No audience/scale signal in the idea text; smallest safe default.",
        },
      ],
      testResults: [],
      recommendedNextActions: ["Proceed to Solution Architect"],
    }),
  [FAILURE]: ({ task }) => fail(task, "idea lacks enough detail to draft requirements safely"),
};

const researchAgent: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "Reviewed prior art for screenshot-capture and report-generation tooling.",
      artifacts: [
        {
          kind: "artifact",
          artifactType: "research-notes",
          content:
            "# Research Notes\n\nExisting tools in this space are typically CLI-driven with a simple file-based output. No unusual technical risk identified.",
        },
      ],
      decisions: [],
      testResults: [],
      recommendedNextActions: ["Proceed to Solution Architect"],
    }),
  [FAILURE]: ({ task }) => fail(task, "no relevant prior art found within the given scope"),
};

const solutionArchitect: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "Proposed a minimal architecture for the tool.",
      artifacts: [
        {
          kind: "artifact",
          artifactType: "architecture",
          content:
            "# Architecture\n\n- CLI entry point captures a screenshot to a local directory.\n- A report generator reads captured screenshots and renders an HTML report.\n- No external services required.",
        },
      ],
      decisions: [
        {
          kind: "decision",
          type: "decision",
          summary: "Local file storage only — no database or external service for this scope.",
        },
      ],
      testResults: [],
      recommendedNextActions: ["Proceed to Development"],
    }),
  [FAILURE]: ({ task }) => fail(task, "requirements conflict in a way that prevents a stable architecture"),
};

const uiUxAgent: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "Proposed a minimal UX flow for the tool.",
      artifacts: [
        {
          kind: "artifact",
          artifactType: "ux-spec",
          content: "# UX Spec\n\n1. Capture screen -> 2. Review captured screenshots -> 3. Generate report.",
        },
      ],
      decisions: [],
      testResults: [],
      recommendedNextActions: ["Proceed to Development"],
    }),
  [FAILURE]: ({ task }) => fail(task, "requirements do not specify enough to design a flow"),
};

function developerFixtures(roleLabel: string): Record<string, Fixture> {
  return {
    [SUCCESS]: ({ task }) =>
      succeed(task, {
        summary: `${roleLabel}: implemented the tool per the approved architecture.`,
        artifacts: [
          {
            kind: "artifact",
            artifactType: "code",
            content: [
              "# Implementation Summary",
              "",
              "Files planned:",
              "- capture.ts — takes a screenshot, saves to ./captures/",
              "- report.ts — reads ./captures/, renders report.html",
              "",
              "(Simulated — no real source files were created.)",
            ].join("\n"),
          },
        ],
        decisions: [],
        testResults: [],
        recommendedNextActions: ["Proceed to QA"],
      }),
    [RETRY_SUCCESS]: ({ task }) =>
      succeed(task, {
        summary: `${roleLabel}: applied a fix for the QA-reported issue.`,
        artifacts: [
          {
            kind: "artifact",
            artifactType: "code",
            content: [
              "# Implementation Summary (fix)",
              "",
              "Fixed: report generation threw when the capture directory was empty.",
              "- report.ts — now validates capture count before rendering, returns a clear message if empty.",
              "",
              "(Simulated — no real source files were created.)",
            ].join("\n"),
            version: 2,
          },
        ],
        decisions: [],
        testResults: [],
        recommendedNextActions: ["Proceed to QA (re-run)"],
      }),
    [FAILURE]: ({ task }) => fail(task, "architecture does not specify enough detail to implement"),
  };
}

const qaAgent: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "All tests passed.",
      artifacts: [],
      decisions: [],
      testResults: [
        {
          kind: "test-result",
          status: "PASS",
          summary: "3/3 checks passed: capture, report generation, empty-input handling.",
        },
      ],
      recommendedNextActions: ["Proceed to Security Review"],
    }),
  // QA's "failure" is a successful test *run* that found failing tests —
  // modeled as AgentTaskResult.status "FAILED" because the task's
  // Definition of Done (passing tests) was not met. See the Phase 4
  // status note in docs/ai-office/11-implementation-phases.md for why.
  [FAILURE]: ({ task }) =>
    fail(task, "report generation throws when the capture directory is empty", {
      testResults: [
        {
          kind: "test-result",
          status: "FAIL",
          summary: "2/3 checks passed: capture OK, report generation OK, empty-input handling FAILED.",
          details: { failedCases: ["report generation throws on empty capture directory"] },
        },
      ],
    }),
};

const securityReviewer: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "No high-severity findings.",
      artifacts: [
        {
          kind: "artifact",
          artifactType: "security-report",
          content: "# Security Review\n\nNo high-severity findings. Local file I/O only, no network/credential surface.",
        },
      ],
      decisions: [],
      testResults: [],
      recommendedNextActions: ["Proceed to Code Review"],
    }),
  [FAILURE]: ({ task }) => fail(task, "high-severity finding: unvalidated file path input"),
};

const codeReviewer: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "Code is consistent with the approved architecture.",
      artifacts: [
        {
          kind: "artifact",
          artifactType: "review-notes",
          content: "# Code Review\n\nConsistent with the proposed architecture. No blocking issues.",
        },
      ],
      decisions: [],
      testResults: [],
      recommendedNextActions: ["Proceed to Release"],
    }),
  [FAILURE]: ({ task }) => fail(task, "inconsistent error handling across modules"),
};

const releaseAgent: Record<string, Fixture> = {
  [SUCCESS]: ({ task }) =>
    succeed(task, {
      summary: "Project is ready for owner review.",
      artifacts: [
        {
          kind: "artifact",
          artifactType: "release-summary",
          content: "# Release Summary\n\nAll quality gates passed. Ready for owner review and approval.",
        },
      ],
      decisions: [],
      testResults: [],
      recommendedNextActions: ["Await owner approval"],
    }),
  [FAILURE]: ({ task }) => fail(task, "missing required inputs for a release summary"),
};

export const SIMULATED_FIXTURES: Record<string, Record<string, Fixture>> = {
  orchestrator,
  "product-owner": productOwner,
  "research-agent": researchAgent,
  "solution-architect": solutionArchitect,
  "ui-ux-agent": uiUxAgent,
  "frontend-developer": developerFixtures("Frontend Developer"),
  "backend-developer": developerFixtures("Backend Developer"),
  "qa-agent": qaAgent,
  "security-reviewer": securityReviewer,
  "code-reviewer": codeReviewer,
  "release-agent": releaseAgent,
};

export function resolveFixture(roleId: string, scenario: string | undefined): Fixture | undefined {
  const roleFixtures = SIMULATED_FIXTURES[roleId];
  if (!roleFixtures) return undefined;
  const key = scenario ?? SUCCESS;
  // Roles without a distinct retry-success fixture fall back to success —
  // the "retry" is evidenced by attemptNumber/history, not by different
  // fixture content, for roles where that distinction isn't meaningful.
  return roleFixtures[key] ?? (key === RETRY_SUCCESS ? roleFixtures[SUCCESS] : undefined);
}
