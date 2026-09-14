/**
 * Deterministic intent classification (Section T — "This phase must NOT
 * depend on Claude LIVE... deterministic intent handling for common
 * owner commands"). No model call, no network, purely pattern matching
 * against the exact kinds of things Section Q's examples ask. Anything
 * that doesn't match a known pattern becomes `UNKNOWN`, answered
 * honestly rather than guessed at.
 */
export type AssistantIntent =
  | { kind: "STATUS" }
  | { kind: "NEEDS_ATTENTION" }
  | { kind: "BLOCKED_WHY"; projectNameHint: string | null }
  | { kind: "AGENT_NEEDS"; roleNameHint: string }
  | { kind: "SPEND" }
  | { kind: "APPROVALS_NEEDED" }
  | { kind: "QA_RESULT"; projectNameHint: string | null }
  | { kind: "READY_FOR_REVIEW" }
  | { kind: "NEXT_ACTION" }
  | { kind: "OVERNIGHT_BRIEF" }
  | { kind: "PAUSE_PROJECT"; projectNameHint: string | null }
  | { kind: "RESUME_PROJECT"; projectNameHint: string | null }
  | { kind: "OPEN_OFFICE" }
  | { kind: "CLOSE_OFFICE" }
  | { kind: "APPROVE" }
  | { kind: "REJECT" }
  | { kind: "CONFIRM" }
  | { kind: "CANCEL" }
  | { kind: "UNKNOWN"; raw: string };

const ROLE_NAMES = [
  "product owner",
  "research agent",
  "solution architect",
  "ui/ux agent",
  "ui ux agent",
  "frontend developer",
  "backend developer",
  "qa agent",
  "qa/test agent",
  "security reviewer",
  "code reviewer",
  "release agent",
  "orchestrator",
];

function extractQuotedOrTrailing(text: string, afterKeyword: RegExp): string | null {
  const quoted = /"([^"]+)"/.exec(text);
  if (quoted) return quoted[1];
  const match = afterKeyword.exec(text);
  return match ? match[1].trim() : null;
}

export function parseIntent(rawText: string): AssistantIntent {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  if (/^(confirm|yes|do it|go ahead)\.?$/.test(lower)) return { kind: "CONFIRM" };
  if (/^(cancel|no|never ?mind|stop)\.?$/.test(lower)) return { kind: "CANCEL" };

  if (/\b(close|shut down)\b.*\boffice\b/.test(lower)) return { kind: "CLOSE_OFFICE" };
  if (/\bopen\b.*\boffice\b/.test(lower)) return { kind: "OPEN_OFFICE" };

  if (/\bpause\b/.test(lower)) return { kind: "PAUSE_PROJECT", projectNameHint: extractQuotedOrTrailing(text, /pause\s+(?:the\s+)?(?:project\s+)?(.+)/i) };
  if (/\bresume\b/.test(lower)) return { kind: "RESUME_PROJECT", projectNameHint: extractQuotedOrTrailing(text, /resume\s+(?:the\s+)?(?:project\s+)?(.+)/i) };

  if (/\b(approve)\b/.test(lower)) return { kind: "APPROVE" };
  if (/\b(reject|deny)\b/.test(lower)) return { kind: "REJECT" };

  if (/what.*(everyone|everybody).*(working|doing)/.test(lower) || /\bstatus\b/.test(lower) || /what.*happening/.test(lower)) {
    return { kind: "STATUS" };
  }
  if (/approvals?.*need|which projects need|pending approvals?|need(s)? my approval/.test(lower)) return { kind: "APPROVALS_NEEDED" };
  if (/needs? my attention|what needs attention/.test(lower)) return { kind: "NEEDS_ATTENTION" };

  if (/why is|why's|why does/.test(lower) && /blocked|stuck/.test(lower)) {
    return { kind: "BLOCKED_WHY", projectNameHint: extractQuotedOrTrailing(text, /why (?:is|'s|does)\s+(.+?)\s+(?:blocked|stuck)/i) };
  }

  const roleMatch = ROLE_NAMES.find((r) => lower.includes(r));
  if (roleMatch && /need|working on|doing/.test(lower)) {
    return { kind: "AGENT_NEEDS", roleNameHint: roleMatch };
  }

  if (/how much.*spent|spend|cost/.test(lower)) return { kind: "SPEND" };
  if (/qa (found|result)|what did qa/.test(lower)) return { kind: "QA_RESULT", projectNameHint: extractQuotedOrTrailing(text, /(?:in|for)\s+(.+)/i) };
  if (/ready for review/.test(lower)) return { kind: "READY_FOR_REVIEW" };
  if (/next action|what.?s next|what should i do/.test(lower)) return { kind: "NEXT_ACTION" };
  if (/overnight|what happened (overnight|while i was away)|since last/.test(lower)) return { kind: "OVERNIGHT_BRIEF" };

  return { kind: "UNKNOWN", raw: text };
}
