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

/**
 * Real defect found in the second AI Office pilot: a genuine product
 * idea ("Build a polished personal task manager called TaskFlow" — full
 * text describes create/edit/complete/delete tasks, All/Active/Completed
 * filters, search, "responsive desktop/mobile design," "accessible
 * keyboard-friendly controls," "working preview," a downloadable ZIP,
 * and explicit "No login. No backend. No external APIs.") never matched
 * a single word in this list — it describes a browser UI throughout
 * without ever using the literal words "app"/"ui"/"interface"/"page"/
 * etc. Widened with the concrete phrases real product descriptions
 * actually use for browser-based interaction, still every entry a
 * genuine, unambiguous UI noun/phrase (never a word that could equally
 * describe a CLI or backend service).
 */
const UI_SIGNALS = [
  "web app",
  "web application",
  "webpage",
  "web page",
  "app",
  "website",
  "ui",
  "screen",
  "interface",
  "dashboard",
  "mobile app",
  "frontend",
  "form",
  "page",
  "responsive design",
  "responsive desktop",
  "desktop/mobile",
  "desktop and mobile",
  "keyboard-friendly",
  "keyboard accessible",
  "keyboard-accessible",
  "working preview",
  "browser",
  "task manager",
  "to-do list",
  "todo list",
];
/** A CLI/terminal deliverable has no browser UI at all — checked before the ambiguous-idea fallback below, so a CLI request is never misrouted to frontend-developer just because it also mentions neither UI nor backend signals. */
const CLI_SIGNALS = ["cli", "command-line", "command line", "terminal", "shell script"];
/**
 * Signals that the idea genuinely needs server-side behavior — API,
 * database, auth, server-side persistence/logic, background processing,
 * or an external backend service/integration. Deliberately does NOT
 * include generic words like "store"/"save"/"persist" on their own,
 * since those are just as often client-side (e.g. "store to browser
 * localStorage") — every signal here is either an unambiguous noun
 * (database, API) or a specific server-side phrase, not a word that
 * could plausibly describe purely client-side behavior.
 */
const BACKEND_SIGNALS = [
  "database",
  "rest api",
  "api endpoint",
  "api",
  "backend",
  "server-side",
  "server persistence",
  "backend service",
  "authentication",
  "user account",
  "user accounts",
  "background job",
  "background processing",
  "cron job",
  "scheduled job",
  "scheduled task",
  "webhook",
  "microservice",
  "external service",
  "third-party service",
  "external backend",
];
const SECURITY_SIGNALS = ["auth", "login", "password", "payment", "credit card", "pii", "personal data", "external api", "third-party", "integration", "network"];
const RESEARCH_SIGNALS = ["explore", "research", "investigate", "unfamiliar", "not sure", "prior art", "feasibility"];
const APPROVAL_SIGNALS = ["paid service", "purchase", "subscription", "buy a", "external account"];
const DEPLOY_SIGNALS = ["deploy to production", "production deployment", "ship to production", "go live in production"];

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
 * A real UI acceptance run surfaced this exact bug: "work without
 * requiring a backend or database" contains both "backend" and
 * "database" as bare words, so a plain `includesAny` check reads it as
 * two explicit backend signals — the opposite of what the sentence
 * actually says. Only applied to BACKEND_SIGNALS (not the other signal
 * categories) since a false-positive backend inclusion is the most
 * costly mistake role selection can make (an entire unnecessary agent
 * role). A short, local word window immediately before the match is
 * enough to catch the natural ways someone phrases this ("without a
 * database", "no backend needed", "doesn't require a database") without
 * trying to parse the sentence — still a deterministic keyword rule, not
 * a language model.
 */
const NEGATION_CUES = ["without", "no ", "not ", "don't", "do not", "doesn't", "does not", "never need", "never require", "excluding", "no need for", "not require", "not need"];

function isNegatedMatch(text: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - 60);
  const window = text.slice(windowStart, matchIndex);
  return NEGATION_CUES.some((cue) => window.includes(cue));
}

function includesAnyUnlessNegated(text: string, signals: string[]): string[] {
  const hits: string[] = [];
  for (const signal of signals) {
    const match = new RegExp(`\\b${escapeRegExp(signal)}\\b`, "i").exec(text);
    if (match && !isNegatedMatch(text, match.index)) hits.push(signal);
  }
  return hits;
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
  const needsFrontend = uiHits.length > 0;
  if (needsFrontend) {
    roles.push("ui-ux-agent", "frontend-developer");
    rationale.push(`ui-ux-agent, frontend-developer included: idea mentions UI/screen signal(s) [${uiHits.join(", ")}].`);
  }

  // Capability-driven, not unconditional: backend-developer is only
  // selected when the idea genuinely implies server-side behavior (API,
  // database, auth, server-side persistence/logic, background
  // processing, or an external backend service) — see BACKEND_SIGNALS.
  // A UI-only idea (a static/client-side page, e.g. "a landing page" or
  // "a todo page using browser localStorage") never needed a backend
  // just because it happened to also need a frontend.
  const cliHits = includesAny(text, CLI_SIGNALS);
  const backendHits = includesAnyUnlessNegated(text, BACKEND_SIGNALS);
  const needsBackend = backendHits.length > 0 || (!needsFrontend && cliHits.length > 0);
  if (needsBackend) {
    roles.push("backend-developer");
    rationale.push(
      backendHits.length > 0
        ? `backend-developer included: idea signals server-side behavior [${backendHits.join(", ")}].`
        : `backend-developer included: idea is a CLI/terminal deliverable with no browser UI [${cliHits.join(", ")}].`,
    );
  } else {
    rationale.push("backend-developer excluded: idea describes client-side-only behavior with no server-side signal.");
  }

  // Real defect found in the second AI Office pilot: an idea with
  // NEITHER a UI signal NOR a backend/CLI signal used to default to
  // backend-developer alone — silently producing a backend-only plan
  // for what, in practice, is almost always a small product a person
  // expects to actually use (open, click, see something), not an
  // invisible service. A genuine idea ("Build a polished personal task
  // manager called TaskFlow...") that unambiguously describes browser
  // interaction throughout (filters, search, "responsive desktop/mobile
  // design," a "working preview") hit exactly this fallback and got a
  // task graph with no frontend-developer at all — a real, user-facing
  // app request that could structurally never pass its own QA gate
  // (which correctly requires a real browser-loadable deliverable for
  // any project that claims to have a UI). The safe default for a
  // genuinely ambiguous idea is now a UI, unless the idea explicitly
  // signals API/backend-only or CLI/terminal-only — matching the
  // brief's own rule: "a request requiring a usable UI cannot produce a
  // backend-only task graph unless the user explicitly requested an
  // API/backend-only project."
  if (!needsFrontend && !needsBackend) {
    roles.push("ui-ux-agent", "frontend-developer");
    rationale.push("ui-ux-agent, frontend-developer included: idea has no explicit UI, backend, or CLI signal — defaulting to a usable interface rather than an invisible backend-only service.");
  }

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

/**
 * A second, independent synthetic approval signal — Phase 6's
 * demonstration that approval *scope* matters
 * (docs/ai-office/11-implementation-phases.md's Phase 6 status note,
 * "exact-scope enforcement"). Unlike `requiresOwnerApproval` above
 * (which blocks the *whole project*, matching Phase 5's original
 * behavior unchanged), a match here scopes its approval to exactly the
 * project's `release-agent` task — every other task keeps running.
 * Deliberately a disjoint keyword set from `APPROVAL_SIGNALS` so the two
 * triggers can be exercised independently (approving one must never
 * satisfy the other) without relying on a shared idea text.
 */
export function requiresDeploymentApproval(ideaText: string): { required: boolean; matchedSignal?: string } {
  const hits = includesAny(ideaText, DEPLOY_SIGNALS);
  return hits.length > 0 ? { required: true, matchedSignal: hits[0] } : { required: false };
}
