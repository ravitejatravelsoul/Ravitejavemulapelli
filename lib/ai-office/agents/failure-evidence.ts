/**
 * Deterministic, lossless-in-meaning compaction of raw failure evidence
 * (e.g. a Playwright call log) before it is stored or sent to a
 * remediation attempt. Strips terminal colour codes and drops
 * repeated retry-loop noise, while keeping the primary error line, every
 * distinct diagnostic line (such as the element that "intercepts pointer
 * events") and how many times the loop repeated. No model is involved.
 */

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const RETRY_NOISE = [
  /^-?\s*waiting \d+ms$/i,
  /^-?\s*scrolling into view if needed$/i,
  /^-?\s*done scrolling$/i,
  /^-?\s*retrying (click|fill|hover|tap) action$/i,
  /^-?\s*element is visible, enabled and stable$/i,
  /^-?\s*attempting (click|fill|hover|tap) action$/i,
  /^(\d+ × )?waiting for element to be visible, enabled and stable$/i,
];

export function compactFailureEvidence(text: string, maxChars = 1200): string {
  const lines = text.replace(ANSI, "").split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const counts = new Map<string, number>();
  const kept: string[] = [];
  for (const raw of lines) {
    const normalized = raw.trim().replace(/^-\s*/, "");
    if (normalized === "") continue;
    if (RETRY_NOISE.some((p) => p.test(raw.trim()))) continue;
    const n = (counts.get(normalized) ?? 0) + 1;
    counts.set(normalized, n);
    if (n === 1) kept.push(raw.trim());
  }
  const out = kept.map((l) => {
    const n = counts.get(l.replace(/^-\s*/, "")) ?? 1;
    return n > 1 ? `${l} (repeated ${n}x)` : l;
  });
  const joined = out.join("\n");
  if (joined.length <= maxChars) return joined;
  // Keep the beginning (primary error) and the end (final observation).
  const head = joined.slice(0, Math.floor(maxChars * 0.7));
  const tail = joined.slice(joined.length - Math.floor(maxChars * 0.3));
  return `${head}\n…(evidence compacted)…\n${tail}`;
}
