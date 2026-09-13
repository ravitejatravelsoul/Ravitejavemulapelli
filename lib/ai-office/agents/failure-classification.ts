import "server-only";

/**
 * Provider/execution failure vs. task/deliverable failure — a real
 * acceptance run showed a malformed-JSON provider response and a 120s
 * provider timeout each consume one of a developer's real (small,
 * 3-attempt) retry budget exactly like a genuine bad implementation
 * would, even though neither says anything about whether the code itself
 * was right. This function is the single shared classifier: every reason
 * string this codebase itself generates for a pure infrastructure/
 * protocol failure (never a role's own reported failure, which is always
 * semantic) matches one of these patterns. Matched against *known,
 * controlled* message prefixes this codebase produces itself
 * (OllamaConnectionError/OllamaTimeoutError/AdapterTimeoutError/
 * malformedResult's exact wording, Claude's "Operational:" prefix) — not
 * a guess against arbitrary free text, so this stays a precise, low-risk
 * classification rather than fragile string-sniffing.
 *
 * Extracted out of `agent-runner.ts` (its original home, and still its
 * primary caller) so the Living Office UI's Agent Room "Progress" tab can
 * honestly label a failure as operational vs. semantic without either
 * re-implementing the same regex list from scratch (real drift risk) or
 * importing `agent-runner.ts` itself, which is deliberately the *only*
 * module allowed to import a provider adapter — this module touches
 * neither providers nor the database, so sharing it is safe.
 */
export function isOperationalFailureReason(reason: string): boolean {
  return (
    /^Ollama request timed out/.test(reason) ||
    /^Could not reach Ollama/.test(reason) ||
    /^Ollama responded with HTTP/.test(reason) ||
    /Ollama's (HTTP response body|model output) was not valid JSON/.test(reason) ||
    /did not match the expected structured shape/.test(reason) ||
    /^Execution timed out after/.test(reason) ||
    /^Operational:/.test(reason)
  );
}
