import "server-only";

/**
 * The approved agent role catalog — docs/ai-office/04-agent-architecture.md
 * §1, one row per role. This is the single source of truth the DB seed
 * (lib/ai-office/db/seed.ts) inserts verbatim; nothing else should
 * hand-write these values elsewhere.
 *
 * Internal detail (permittedActions, allowedInputs/Outputs) — never
 * expose this shape to the public site. The public `/ai-office` page's
 * role gallery (components/ai-office/roles-gallery.tsx) hard-codes its
 * own short public-safe copy independently; it does not and should not
 * import this file. See docs/ai-office/08-security-plan.md §12.
 *
 * `id` slugs and `maxRetries`/`escalatesTo` defaults are this project's
 * own implementer decision — the planning docs name a `qa-agent` /
 * `solution-architect` example but don't enumerate every id or a numeric
 * retry ceiling; recorded here and in the Phase 3 status note in
 * docs/ai-office/11-implementation-phases.md rather than invented
 * silently.
 */

export interface AgentRoleSeed {
  id: string;
  name: string;
  responsibilities: string[];
  allowedInputs: string[];
  allowedOutputs: string[];
  permittedActions: string[];
  maxRetries: number;
  escalatesTo: "orchestrator" | "owner";
}

const DEFAULT_MAX_RETRIES = 3;

export const AGENT_ROLE_CATALOG: AgentRoleSeed[] = [
  {
    id: "orchestrator",
    name: "Chief of Staff / Orchestrator",
    responsibilities: [
      "Interpret idea",
      "Assess complexity",
      "Select roles",
      "Build task plan",
      "Track dependencies",
      "Enforce gates",
    ],
    allowedInputs: ["idea", "project-memory"],
    allowedOutputs: [],
    permittedActions: ["plan-tasks", "select-roles", "enforce-gates"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "owner",
  },
  {
    id: "product-owner",
    name: "Product Owner",
    responsibilities: ["Turn idea into requirements", "Record assumptions as decisions"],
    allowedInputs: ["idea", "project-memory"],
    allowedOutputs: ["requirements"],
    permittedActions: ["write-artifact", "record-decision"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "research-agent",
    name: "Research Agent",
    responsibilities: ["Feasibility and prior-art research when the idea is ambiguous or novel"],
    allowedInputs: ["requirements", "project-memory"],
    allowedOutputs: ["research-notes"],
    permittedActions: ["write-artifact"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "solution-architect",
    name: "Solution Architect",
    responsibilities: ["Propose architecture, data model, tech choices"],
    allowedInputs: ["requirements", "research-notes", "project-memory"],
    allowedOutputs: ["architecture"],
    permittedActions: ["write-artifact", "record-decision"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "ui-ux-agent",
    name: "UI/UX Agent",
    responsibilities: ["Propose UX flows/screens"],
    allowedInputs: ["requirements", "architecture"],
    allowedOutputs: ["ux-spec"],
    permittedActions: ["write-artifact"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "frontend-developer",
    name: "Frontend Developer",
    responsibilities: ["Implement UI per architecture/UX spec"],
    allowedInputs: ["architecture", "ux-spec"],
    allowedOutputs: ["code"],
    permittedActions: ["write-artifact"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "backend-developer",
    name: "Backend Developer",
    responsibilities: ["Implement server/data logic"],
    allowedInputs: ["architecture"],
    allowedOutputs: ["code"],
    permittedActions: ["write-artifact"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "qa-agent",
    name: "QA/Test Agent",
    responsibilities: ["Verify Definition of Done", "Write/run tests"],
    allowedInputs: ["code", "requirements"],
    allowedOutputs: ["test-report"],
    permittedActions: ["write-artifact", "run-tests", "record-failure"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    responsibilities: ["Check for security-sensitive issues"],
    allowedInputs: ["code"],
    allowedOutputs: ["security-report"],
    permittedActions: ["write-artifact"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    responsibilities: ["Review code quality/consistency"],
    allowedInputs: ["code"],
    allowedOutputs: ["review-notes"],
    permittedActions: ["write-artifact"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
  {
    id: "release-agent",
    name: "Release Agent",
    responsibilities: ["Prepare final package for owner approval"],
    allowedInputs: ["architecture", "test-report", "security-report", "review-notes"],
    allowedOutputs: ["release-summary"],
    permittedActions: ["write-artifact"],
    maxRetries: DEFAULT_MAX_RETRIES,
    escalatesTo: "orchestrator",
  },
];
