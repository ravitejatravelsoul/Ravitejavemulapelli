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
 * whether the second serves the first. Used at two checkpoints in
 * agent-runner.ts:
 *   1. Before development starts, comparing the planned architecture/UX
 *      against the authoritative request (Phase 8 Part U-style
 *      requirement: "fail architecture, don't let developers build the
 *      wrong thing").
 *   2. Before a real deliverable is marked VERIFIED, comparing what was
 *      actually built (extracted page text) against the same request.
 *
 * Deliberately fail-open: this is a supplementary safety net, not the
 * primary correctness mechanism (that's giving every role the
 * authoritative request directly and prominently — see
 * TaskContext.authoritativeUserRequest). If the check itself can't run
 * (Ollama unreachable, malformed response), it must never become a new
 * single point of failure that silently blocks every Ollama project —
 * it reports `consistent: true` with a reason explaining why it
 * couldn't check, exactly like `estimateCost`/other best-effort paths
 * elsewhere in this codebase already do.
 *
 * $0 cost: identical Ollama HTTP call shape to OllamaAdapter, but not
 * counted as a task's own `ai_usage` row — this is an internal planning
 * sanity check, not a role producing a billable artifact. Still never
 * touches Claude/LIVE, still respects OLLAMA_BASE_URL/OLLAMA_MODEL.
 */

export interface IntentConsistencyResult {
  consistent: boolean;
  reason: string;
}

export interface IntentConsistencyInput {
  /** The original, unedited user request — always the standard to check against. */
  authoritativeUserRequest: string;
  /** What's being checked against it — a plan (architecture + UX text) or a description of what was actually built. */
  candidate: string;
  /** Shown in the reason text on a fail-open path, e.g. "planned architecture" or "built deliverable". */
  checkpointLabel: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma4:latest";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CANDIDATE_CHARS = 4000;

function buildCheckPrompt(authoritativeUserRequest: string, candidate: string): string {
  return [
    "You are a strict but fair reviewer checking whether a project deliverable actually serves what its owner asked for.",
    "",
    "AUTHORITATIVE USER REQUEST (the only definition of what should be built):",
    authoritativeUserRequest,
    "",
    "CANDIDATE (the plan or built result to check against that request):",
    candidate.slice(0, MAX_CANDIDATE_CHARS),
    "",
    "Does the candidate serve the authoritative user request? Ignore project titles, tool names, or provider names that may appear in either text — judge only whether the actual product described/built matches what was asked for.",
    'Respond with ONLY a single JSON object: {"consistent": boolean, "reason": string}. "reason" must be one concise sentence.',
  ].join("\n");
}

/**
 * Runs the check. Never throws — a network/parse failure resolves to
 * `{ consistent: true, reason: "..." }` (fail-open) rather than blocking
 * the pipeline on the checker's own reliability.
 */
export async function checkIntentConsistency(input: IntentConsistencyInput): Promise<IntentConsistencyResult> {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
  const model = input.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;

  if (!input.authoritativeUserRequest.trim() || !input.candidate.trim()) {
    return { consistent: true, reason: "Nothing to compare yet — skipping the intent-consistency check." };
  }

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
      return { consistent: true, reason: `Intent-consistency check skipped: Ollama responded with HTTP ${response.status}.` };
    }
    const body = (await response.json()) as { response?: string };
    const parsed = JSON.parse(body.response ?? "");
    if (typeof parsed.consistent !== "boolean") {
      return { consistent: true, reason: "Intent-consistency check skipped: model response did not include a boolean 'consistent' field." };
    }
    return { consistent: parsed.consistent, reason: typeof parsed.reason === "string" ? parsed.reason : "(no reason given)" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { consistent: true, reason: `Intent-consistency check for ${input.checkpointLabel} could not run (${message}) — proceeding without it.` };
  } finally {
    clearTimeout(timer);
  }
}
