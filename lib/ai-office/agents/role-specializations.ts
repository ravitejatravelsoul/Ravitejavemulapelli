/**
 * Static role metadata — describes what a role IS and does, not any
 * runtime state, so it needs no database access and never changes per
 * project. Used by the Agent Workspace's header/Capabilities view
 * (Section 4/19 of the Agent Workspace phase).
 */
export interface RoleSpecialization {
  mission: string;
  capabilities: string[];
  responsibilities: string[];
}

export const ROLE_SPECIALIZATIONS: Record<string, RoleSpecialization> = {
  orchestrator: {
    mission: "Plan the project and coordinate every other role toward a real, verified deliverable.",
    capabilities: ["Role selection", "Task planning", "Dependency coordination", "Approval escalation"],
    responsibilities: [
      "Read the idea and select which of the 11 roles the project actually needs",
      "Build the task graph and its dependency order",
      "Escalate to the owner when approval or budget is required",
      "Track blocked work and decide what happens next",
    ],
  },
  "product-owner": {
    mission: "Turn the raw idea into clear, buildable requirements.",
    capabilities: ["Requirements analysis", "Acceptance criteria", "Scope definition", "Prioritization"],
    responsibilities: [
      "Define what the product must do and for whom",
      "Write concrete acceptance criteria other roles can build and test against",
      "Keep scope realistic for the project's size and budget",
    ],
  },
  "research-agent": {
    mission: "Investigate prior art and technical options before design begins.",
    capabilities: ["Research", "Feasibility analysis", "Prior-art discovery", "Technical investigation"],
    responsibilities: [
      "Look for existing approaches relevant to the idea",
      "Flag technical risks or constraints early",
      "Hand findings to the Solution Architect and Product Owner",
    ],
  },
  "solution-architect": {
    mission: "Design the technical approach the rest of the build follows.",
    capabilities: ["System architecture", "Technical design", "Dependency planning", "Architecture decisions"],
    responsibilities: [
      "Choose the overall technical structure of the deliverable",
      "Decide how frontend, backend, and data pieces fit together",
      "Record architecture decisions with rationale",
    ],
  },
  "ui-ux-agent": {
    mission: "Design how the product looks, flows, and feels to use.",
    capabilities: ["Interaction design", "Responsive UX", "Visual hierarchy", "Component design"],
    responsibilities: [
      "Define the UX flow and key screens/components",
      "Set the visual hierarchy and responsive behavior",
      "Hand off a spec the Frontend Developer can implement directly",
    ],
  },
  "frontend-developer": {
    mission: "Build the real, working user interface.",
    capabilities: ["React", "Next.js", "TypeScript", "Responsive UI", "Accessibility"],
    responsibilities: [
      "Implement the UI/UX spec as real, running code",
      "Materialize actual files into the project workspace",
      "Fix issues QA or Code Review send back",
    ],
  },
  "backend-developer": {
    mission: "Build the server-side logic and data the product needs.",
    capabilities: ["APIs", "Server logic", "Data modeling", "Integrations"],
    responsibilities: [
      "Implement APIs and server logic the frontend depends on",
      "Model and persist the data the product needs",
      "Fix issues QA or Code Review send back",
    ],
  },
  "qa-agent": {
    mission: "Verify the real deliverable actually works before it ships.",
    capabilities: ["Test planning", "Browser testing", "Regression testing", "Defect validation"],
    responsibilities: [
      "Run a real verification pass against the built deliverable",
      "Record an honest PASS/FAIL result, never a guess",
      "Send real defects back to the responsible role",
    ],
  },
  "security-reviewer": {
    mission: "Look for real security and safety issues before release.",
    capabilities: ["Threat review", "Secrets/security validation", "Authorization review", "Risk analysis"],
    responsibilities: [
      "Check for exposed secrets, unsafe input handling, and access-control gaps",
      "Record findings as resolved or unresolved risks",
      "Block release when a real risk is unresolved",
    ],
  },
  "code-reviewer": {
    mission: "Review the real implementation for correctness and maintainability.",
    capabilities: ["Implementation review", "Maintainability", "Correctness", "Standards"],
    responsibilities: [
      "Review the actual code the developers produced",
      "Flag correctness and maintainability issues",
      "Approve or send work back with a concrete reason",
    ],
  },
  "release-agent": {
    mission: "Confirm the deliverable is genuinely ready and prepare the handoff.",
    capabilities: ["Readiness validation", "Release checklist", "Packaging/handoff"],
    responsibilities: [
      "Confirm QA, Security, and Code Review all really passed",
      "Verify a real, working deliverable exists in the workspace",
      "Prepare the final release summary",
    ],
  },
};

const FALLBACK_SPECIALIZATION: RoleSpecialization = {
  mission: "Contribute to the project as assigned by the Orchestrator.",
  capabilities: [],
  responsibilities: [],
};

export function getRoleSpecialization(roleId: string): RoleSpecialization {
  return ROLE_SPECIALIZATIONS[roleId] ?? FALLBACK_SPECIALIZATION;
}
