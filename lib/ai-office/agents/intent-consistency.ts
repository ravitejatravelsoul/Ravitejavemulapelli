import "server-only";

/**
 * A generic, reusable "does this actually serve the user's request"
 * check — added after a real acceptance run showed the gap this closes:
 * a real local model produced a plan/deliverable that technically
 * succeeded at its own narrow task but had drifted from what the owner
 * actually asked for (it built an Ollama API client because the project
 * was titled "Ollama Hello World Build", even though the idea text asked
 * for a plain webpage). Every structural safeguard already in place
 * (schema validation, real QA, retry/escalation) is blind to that kind
 * of drift, because none of them ever compare the *content* against the
 * *request* — they check "is this valid" and "does this work," never
 * "is this actually what was asked for."
 *
 * Deliberately generic: this module knows nothing about "Hello World,"
 * "Ollama," "index.html," or any other example — it takes two arbitrary
 * strings (a request and a candidate) and asks a real local model
 * whether the second serves the first. Used at three checkpoints in
 * agent-runner.ts:
 *   1. Before development starts, comparing the planned architecture/UX
 *      against the authoritative request.
 *   2. Before a real deliverable is marked VERIFIED, comparing what was
 *      actually built (extracted page text) against the same request.
 *   3. On a corrective (retry) attempt, comparing the *proposed* fix
 *      against the request *plus* the currently-working deliverable —
 *      a second real acceptance run showed a retry can drift the
 *      product's identity while "fixing" an unrelated bug (e.g. a
 *      Hello World page rewritten into an unrelated "System Health
 *      Check" page). This checkpoint rejects that *before* the
 *      corrective write is ever applied.
 *
 * Returns a THREE-way outcome — "consistent" | "inconsistent" |
 * "unavailable" — deliberately, not a boolean. Collapsing "the model
 * said no" and "the check couldn't run at all" into the same boolean
 * is exactly the mistake this module used to make: every caller failed
 * open on both, including the *final* VERIFIED gate, which meant a
 * transient Ollama outage could get silently treated as "yes, this
 * matches." Now each caller decides what "unavailable" means for its
 * own checkpoint: a pre-development advisory check can reasonably still
 * let the pipeline proceed (see `resolveAdvisory` below); the final
 * VERIFIED gate must not (see agent-runner.ts's QA block, which reacts
 * to "unavailable" explicitly rather than defaulting to "consistent").
 *
 * $0 cost: identical Ollama HTTP call shape to OllamaAdapter, but not
 * counted as a task's own `ai_usage` row — this is an internal planning
 * sanity check, not a role producing a billable artifact. Still never
 * touches Claude/LIVE, still respects OLLAMA_BASE_URL/OLLAMA_MODEL.
 */

export type IntentConsistencyOutcome = "consistent" | "inconsistent" | "unavailable";

export interface IntentConsistencyResult {
  outcome: IntentConsistencyOutcome;
  reason: string;
}

export interface IntentConsistencyInput {
  /** The original, unedited user request — always the standard to check against. */
  authoritativeUserRequest: string;
  /** What's being checked against it — a plan, a description of what was actually built, or a proposed corrective change. */
  candidate: string;
  /** Shown in the reason text on an "unavailable" outcome, e.g. "planned architecture" or "built deliverable". */
  checkpointLabel: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma4:latest";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CANDIDATE_CHARS = 32000;

/**
 * Bounded, in-process immediate retries for a transient infrastructure
 * blip (connection refused, one malformed JSON response) — separate
 * from, and much smaller than, the real task-retry ceiling. See
 * agent-runner.ts's `isOperationalFailureReason`/operational-retry
 * wrapper for the same pattern applied to the main adapter call; both
 * exist for the same reason (Part 17 of the follow-up brief this
 * closes): a temporary provider hiccup should not consume real retry
 * budget meant for genuine implementation problems.
 */
const MAX_INTERNAL_RETRIES = 2;

function buildCheckPrompt(authoritativeUserRequest: string, candidate: string): string {
  return [
    "You are a strict but fair reviewer checking whether a project deliverable actually serves what its owner asked for.",
    "",
    "AUTHORITATIVE USER REQUEST (the only definition of what should be built):",
    authoritativeUserRequest,
    "",
    "CANDIDATE (the plan, built result, or proposed change to check against that request):",
    candidate,
    "",
    "Does the candidate serve the authoritative user request? Ignore project titles, tool names, or provider names that may appear in either text — judge only whether the actual product described/built matches what was asked for.",
    'Respond with ONLY a single JSON object: {"consistent": boolean, "reason": string}. "reason" must be one concise sentence.',
  ].join("\n");
}

/** One single HTTP attempt — never retries, never throws. Returns "unavailable" (not a fail-open guess) whenever it can't produce a real verdict. */
async function attemptOnce(input: IntentConsistencyInput): Promise<IntentConsistencyResult> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
  const model = input.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: buildCheckPrompt(input.authoritativeUserRequest, input.candidate),
        stream: false,
        format: "json",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { outcome: "unavailable", reason: `Ollama responded with HTTP ${response.status}.` };
    }
    const body = (await response.json()) as { response?: string };
    const parsed = JSON.parse(body.response ?? "");
    if (typeof parsed.consistent !== "boolean") {
      return { outcome: "unavailable", reason: "Model response did not include a boolean 'consistent' field." };
    }
    return {
      outcome: parsed.consistent ? "consistent" : "inconsistent",
      reason: typeof parsed.reason === "string" ? parsed.reason : "(no reason given)",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: "unavailable", reason: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the check with up to `MAX_INTERNAL_RETRIES` immediate, in-process
 * retries on an "unavailable" outcome (the check itself failing to
 * produce a verdict) — never throws. A real "consistent"/"inconsistent"
 * verdict is returned as soon as one attempt produces it; only
 * persistent unavailability (every attempt failed) surfaces as
 * "unavailable" to the caller.
 */
export async function checkIntentConsistency(input: IntentConsistencyInput): Promise<IntentConsistencyResult> {
  if (!input.authoritativeUserRequest.trim() || !input.candidate.trim()) {
    return { outcome: "consistent", reason: "Nothing to compare yet — skipping the intent-consistency check." };
  }

  if (input.candidate.length > MAX_CANDIDATE_CHARS) return { outcome: "unavailable", reason: "Candidate evidence exceeds the bounded review context; refusing to review silently truncated evidence." };
  let result = await attemptOnce(input);
  let retries = 0;
  while (result.outcome === "unavailable" && retries < MAX_INTERNAL_RETRIES) {
    retries += 1;
    result = await attemptOnce(input);
  }
  if (result.outcome === "unavailable") {
    return { outcome: "unavailable", reason: `Intent-consistency check for ${input.checkpointLabel} could not run (${result.reason}).` };
  }
  return result;
}
