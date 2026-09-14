import "server-only";
import type { DatabaseSync } from "node:sqlite";

/**
 * The owner's single, office-wide notification policy row — how (if at
 * all) Human Escalation is allowed to reach the owner outside the app.
 * Defaults are deliberately conservative: a brand-new office has `mode =
 * 'OFF'`, so no external communication of any kind happens until the
 * owner explicitly configures it (Section C/I of the Human Escalation
 * phase — "No external communication by default until configured").
 */
export type NotificationMode = "OFF" | "IN_APP" | "SMS" | "CALL_SMS_FALLBACK";
export type EscalationUrgency = "INFO" | "ACTION_REQUIRED" | "URGENT";
export type EscalationChannel = "IN_APP" | "CALL" | "SMS";

export interface NotificationPolicyRow {
  id: string;
  mode: NotificationMode;
  quietHoursEnabled: 0 | 1;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  callWindowStart: string;
  callWindowEnd: string;
  createdAt: number;
  updatedAt: number;
}

const SINGLETON_ID = "singleton";

export function getNotificationPolicy(db: DatabaseSync): NotificationPolicyRow | undefined {
  // node:sqlite's `.get()` returns a null-prototype row object, which
  // React refuses to serialize across the Server -> Client Component
  // boundary ("Only plain objects... can be passed to Client
  // Components") — rebuilt as a plain object literal, same fix already
  // applied elsewhere in this codebase for the same reason.
  const row = db.prepare("SELECT * FROM owner_notification_policy WHERE id = ?").get(SINGLETON_ID) as NotificationPolicyRow | undefined;
  return row ? { ...row } : undefined;
}

/** The safe, conservative default used until the owner has ever saved a policy row. */
export function getEffectiveNotificationPolicy(db: DatabaseSync): NotificationPolicyRow {
  return (
    getNotificationPolicy(db) ?? {
      id: SINGLETON_ID,
      mode: "OFF",
      quietHoursEnabled: 0,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      timezone: "UTC",
      callWindowStart: "08:00",
      callWindowEnd: "21:00",
      createdAt: 0,
      updatedAt: 0,
    }
  );
}

export function setNotificationPolicy(
  db: DatabaseSync,
  input: {
    mode: NotificationMode;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    timezone: string;
    callWindowStart: string;
    callWindowEnd: string;
  },
): NotificationPolicyRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO owner_notification_policy (id, mode, quietHoursEnabled, quietHoursStart, quietHoursEnd, timezone, callWindowStart, callWindowEnd, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       mode = excluded.mode,
       quietHoursEnabled = excluded.quietHoursEnabled,
       quietHoursStart = excluded.quietHoursStart,
       quietHoursEnd = excluded.quietHoursEnd,
       timezone = excluded.timezone,
       callWindowStart = excluded.callWindowStart,
       callWindowEnd = excluded.callWindowEnd,
       updatedAt = excluded.updatedAt`,
  ).run(
    SINGLETON_ID,
    input.mode,
    input.quietHoursEnabled ? 1 : 0,
    input.quietHoursStart,
    input.quietHoursEnd,
    input.timezone,
    input.callWindowStart,
    input.callWindowEnd,
    now,
    now,
  );
  return getNotificationPolicy(db) as NotificationPolicyRow;
}

/**
 * Deterministic urgency → channel mapping (Section C's example policy).
 * Not independently configurable per-urgency in this phase — the single
 * `mode` dial already expresses the owner's overall comfort level, and
 * each mode narrows what happens at each urgency:
 *   OFF                → nothing ever leaves the app, any urgency.
 *   IN_APP              → nothing ever leaves the app, any urgency.
 *   SMS                 → INFO stays in-app; ACTION_REQUIRED/URGENT get SMS.
 *   CALL_SMS_FALLBACK   → INFO stays in-app; ACTION_REQUIRED gets SMS;
 *                         URGENT gets a call (SMS fallback handled by the
 *                         escalation service if the call goes unanswered).
 */
export function resolveChannelForUrgency(policy: NotificationPolicyRow, urgency: EscalationUrgency): EscalationChannel | "NONE" {
  if (policy.mode === "OFF") return "NONE";
  if (policy.mode === "IN_APP") return "IN_APP";
  if (urgency === "INFO") return "IN_APP";
  if (policy.mode === "SMS") return "SMS";
  // CALL_SMS_FALLBACK
  return urgency === "URGENT" ? "CALL" : "SMS";
}

function parseHhMm(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour: hour || 0, minute: minute || 0 };
}

/** The owner's current local wall-clock minute-of-day in their configured IANA timezone — timezone-aware without a new dependency (`Intl` already knows every IANA zone). */
function minuteOfDayInTimezone(timezone: string, now: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "numeric", hour12: false });
  const parts = formatter.formatToParts(new Date(now));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function isWithinWindow(startMinute: number, endMinute: number, current: number): boolean {
  // A window that wraps past midnight (e.g. 22:00-07:00) is checked as
  // "outside the inverse range" rather than assuming start < end.
  if (startMinute === endMinute) return true; // a zero-width window means "always" (misconfiguration-safe, not "never").
  if (startMinute < endMinute) return current >= startMinute && current < endMinute;
  return current >= startMinute || current < endMinute;
}

export function isWithinQuietHours(policy: NotificationPolicyRow, now: number = Date.now()): boolean {
  if (!policy.quietHoursEnabled) return false;
  const start = parseHhMm(policy.quietHoursStart);
  const end = parseHhMm(policy.quietHoursEnd);
  const current = minuteOfDayInTimezone(policy.timezone, now);
  return isWithinWindow(start.hour * 60 + start.minute, end.hour * 60 + end.minute, current);
}

export function isWithinCallWindow(policy: NotificationPolicyRow, now: number = Date.now()): boolean {
  const start = parseHhMm(policy.callWindowStart);
  const end = parseHhMm(policy.callWindowEnd);
  const current = minuteOfDayInTimezone(policy.timezone, now);
  return isWithinWindow(start.hour * 60 + start.minute, end.hour * 60 + end.minute, current);
}
