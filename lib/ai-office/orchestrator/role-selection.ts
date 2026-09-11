import "server-only";

/**
 * Deterministic, keyword-based idea classifier — docs/ai-office/05-orchestration-workflow.md
 * §2's rule table, encoded literally. **This is not AI** — no model, no
 * embeddings, no ambiguity beyond "does this idea's text contain one of
 * these words." Its entire purpose is to prove the orchestration
 * mechanics (role selection → task graph → execution) work correctly
 * before a real model ever replaces or augments this step (an explicit
 * Phase 7+ *option*, not a commitment — see
 * docs/ai-office/14-open-questions.md §6).
 */

export interface RoleSelection {
  roles: string[];
  rationale: string[];
}

const UI_SIGNALS = ["web app", "web application", "website", "ui", "screen", "interface", "dashboard", "mobile app", "frontend", "form", "page"];
const SECURITY_SIGNALS = ["auth", "login", "password", "payment", "credit card", "pii", "personal data", "external api", "third-party", "integration", "network"];
const RESEARCH_SIGNALS = ["explore", "research", "investigate", "unfamiliar", "not sure", "prior art", "feasibility"];
const APPROVAL_SIGNALS = ["paid service", "purchase", "subscription", "buy a", "external account"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary matching, not plain substring — a naive `text.includes(s)`
 * false-positives constantly against this catalog's short single-word
 * signals: "build" contains "ui", "formatting" contains "form". Since
 * nearly every idea in this system literally starts with "Build a...",
 * a plain substring check on "ui" would tag almost every idea as
 * UI/UX-relevant, defeating the entire point of role selection.
 */
function includesAny(text: string, signals: string[]): string[] {
  return signals.filter((s) => new RegExp(`\\b${escapeRegExp(s)}\\b`, "i").test(text));
}

/**
 * Selects the roles required for a given idea, per the approved rule
 * table. Always includes product-owner (every project needs
 * requirements), solution-architect (every project needs an
 * architecture decision, however small), qa-agent and code-reviewer
 * ("any code will be produced" — true for everything this system
 * builds), and release-agent ("project ready for owner review" — the
 * terminal step of every plan). The Orchestrator itself has no task —
 * it's the planner, not a planned step.
 */
export function selectRoles(ideaText: string): RoleSelection {
  const text = ideaText.toLowerCase();
  const roles: string[] = ["product-owner", "solution-architect"];
  const rationale: string[] = [
    "product-owner included: every project needs requirements.",
    "solution-architect included: every project needs an architecture decision.",
  ];

  const uiHits = includesAny(text, UI_SIGNALS);
  if (uiHits.length > 0) {
    roles.push("ui-ux-agent", "frontend-developer");
    rationale.push(`ui-ux-agent, frontend-developer included: idea mentions UI/screen signal(s) [${uiHits.join(", ")}].`);
  }

  // Always include a development role — every idea this system builds
  // involves some implementation logic, UI or not.
  roles.push("backend-developer");
  rationale.push("backend-developer included: every project involves implementation logic.");

  const researchHits = includesAny(text, RESEARCH_SIGNALS);
  const isVeryShort = ideaText.trim().split(/\s+/).filter(Boolean).length < 8;
  if (researchHits.length > 0 || isVeryShort) {
    roles.push("research-agent");
    rationale.push(
      researchHits.length > 0
        ? `research-agent included: idea signals an unfamiliar/ambiguous domain [${researchHits.join(", ")}].`
        : "research-agent included: idea is very short — scope is ambiguous enough to warrant a feasibility pass.",
    );
  }

  // "Any code will be produced" is always true for this system's output.
  roles.push("qa-agent", "code-reviewer");
  rationale.push("qa-agent, code-reviewer included: code will be produced — always required.");

  const securityHits = includesAny(text, SECURITY_SIGNALS);
  if (securityHits.length > 0) {
    roles.push("security-reviewer");
    rationale.push(`security-reviewer included: idea touches auth/payments/PII/external network [${securityHits.join(", ")}].`);
  }

  roles.push("release-agent");
  rationale.push("release-agent included: every project needs a final readiness package for owner review.");

  return { roles, rationale };
}

/**
 * Synthetic, test-only signal for the Phase 5 approval-gate scenario —
 * "use synthetic approval scenarios only," never a real destructive/
 * paid/production trigger. See
 * docs/ai-office/08-security-plan.md §9's `paid_service_purchase` kind.
 */
export function requiresOwnerApproval(ideaText: string): { required: boolean; matchedSignal?: string } {
  const text = ideaText.toLowerCase();
  const hit = APPROVAL_SIGNALS.find((s) => text.includes(s));
  return hit ? { required: true, matchedSignal: hit } : { required: false };
}
