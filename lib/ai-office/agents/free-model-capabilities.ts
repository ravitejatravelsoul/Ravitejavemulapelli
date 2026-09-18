import "server-only";

/**
 * Free multi-model orchestration phase — the capability taxonomy the new
 * free-provider router (free-model-router.ts) selects models against.
 * Deliberately a SEPARATE, superset type from `ModelCapability`
 * (model-router.ts, 5 values: GENERAL/REASONING/CODING/REVIEW/FAST) —
 * that type and everything built on it (LocalModelRouter,
 * capability-budgets.ts, the existing Ollama-only benchmark/
 * recommended-routing system) is left completely untouched by this
 * phase, so existing local-Ollama-only projects keep their exact current
 * behavior. `TaskCapability` only feeds the NEW free-model router, used
 * only by a project that has explicitly opted into
 * `projects.freeModelOrchestration`.
 */

export type TaskCapability =
  | "FAST"
  | "GENERAL"
  | "REASONING"
  | "CODING"
  | "REVIEW"
  | "ARCHITECTURE"
  | "RESEARCH"
  | "SECURITY"
  | "TEST_GENERATION"
  | "STRUCTURED_OUTPUT";

export const TASK_CAPABILITIES: readonly TaskCapability[] = [
  "FAST",
  "GENERAL",
  "REASONING",
  "CODING",
  "REVIEW",
  "ARCHITECTURE",
  "RESEARCH",
  "SECURITY",
  "TEST_GENERATION",
  "STRUCTURED_OUTPUT",
];

/**
 * "Example tendencies only — NOT hard-coded permanent mappings" per the
 * brief: this says what a role's WORK tends to need, never which model
 * performs it — the free-model router still re-selects the actual model
 * per task, at runtime, from whatever registered models currently
 * qualify for these capabilities. A role can require more than one
 * capability; the router requires a candidate model to cover the
 * role's PRIMARY (first-listed) capability at minimum. Unknown/future
 * role ids fall back to `["GENERAL"]` rather than throwing — a new role
 * must never crash routing.
 */
const ROLE_REQUIRED_CAPABILITIES: Readonly<Record<string, readonly TaskCapability[]>> = {
  "product-owner": ["GENERAL", "REASONING", "STRUCTURED_OUTPUT"],
  "research-agent": ["RESEARCH", "REASONING"],
  "ui-ux-agent": ["GENERAL", "REASONING"],
  "solution-architect": ["ARCHITECTURE", "REASONING"],
  "frontend-developer": ["CODING"],
  "backend-developer": ["CODING"],
  "qa-agent": ["TEST_GENERATION", "REVIEW"],
  "security-reviewer": ["SECURITY", "REVIEW"],
  "code-reviewer": ["REVIEW", "CODING"],
  "release-agent": ["FAST", "STRUCTURED_OUTPUT"],
  orchestrator: ["REASONING", "STRUCTURED_OUTPUT"],
};

export function requiredCapabilitiesForRole(roleId: string): readonly TaskCapability[] {
  return ROLE_REQUIRED_CAPABILITIES[roleId] ?? ["GENERAL"];
}

/** The one capability a candidate model MUST cover — the router scores/filters on this; the role's other listed capabilities are informational (surfaced in routing-history UI) rather than additional hard filters, so a role with 3 tendencies isn't impossibly narrowed to a model that covers all 3 at once. */
export function primaryCapabilityForRole(roleId: string): TaskCapability {
  return requiredCapabilitiesForRole(roleId)[0] ?? "GENERAL";
}

/** Classify task intent first; role tendencies supply the default for ambiguous titles. */
export function requiredCapabilitiesForTask(roleId: string, title: string): readonly TaskCapability[] {
  const intent = title.split(/\s[—–]\s/)[0]!.toLowerCase();
  let capabilities: readonly TaskCapability[] = requiredCapabilitiesForRole(roleId);
  if (/security|vulnerabilit/.test(intent)) capabilities = ["SECURITY", "REVIEW"];
  else if (/review/.test(intent)) capabilities = ["REVIEW", "CODING"];
  else if (/test|qa|verif/.test(intent)) capabilities = ["TEST_GENERATION", "REVIEW"];
  else if (/architect/.test(intent)) capabilities = ["ARCHITECTURE", "REASONING"];
  else if (/research|investigat/.test(intent)) capabilities = ["RESEARCH", "REASONING"];
  else if (/implement|fix|code/.test(intent)) capabilities = ["CODING"];
  return [...new Set([...capabilities, "STRUCTURED_OUTPUT" as const])];
}

export function isTaskCapability(value: string): value is TaskCapability {
  return (TASK_CAPABILITIES as readonly string[]).includes(value);
}
