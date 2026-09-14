import "server-only";

/**
 * Normalizes a phone number to a bare `+`-prefixed digit string for
 * equality comparison — e.g. "+1 (555) 123-4567" and "+15551234567" must
 * compare equal, but this is deliberately NOT full E.164 validation of
 * country codes/number plans. Returns `null` for anything that isn't
 * plausibly a phone number at all (too short/long, no digits), so a
 * malformed value never silently compares equal to another malformed
 * value.
 */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.trim().replace(/[^0-9]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** True only when both values normalize to the same non-null phone number. */
export function phoneNumbersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalizedA = normalizePhoneNumber(a);
  const normalizedB = normalizePhoneNumber(b);
  return normalizedA !== null && normalizedA === normalizedB;
}
