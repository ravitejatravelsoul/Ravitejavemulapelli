import { isPlaceholder } from "@/lib/placeholder";

// `timeZone: "UTC"` is required here: a date-only ISO string like "2024-06-01"
// parses as UTC midnight, but Intl.DateTimeFormat defaults to the viewer's
// local timezone — anyone west of UTC (all of the US) would otherwise see
// the previous month for every date on the site.
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A `"TODO: 2024-01-01"` placeholder date parses successfully as a real
 * date (`new Date` extracts the trailing ISO-like substring), which would
 * silently render a made-up date as if it were confirmed. Placeholder dates
 * are checked first so they render as an honest "Date TBD" instead.
 */
export function formatMonthYear(dateString: string): string {
  if (isPlaceholder(dateString)) return "Date TBD";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return monthYear.format(date);
}

export function formatDateRange(start: string, end: string | null): string {
  const startLabel = formatMonthYear(start);
  const endLabel = end ? formatMonthYear(end) : "Present";
  return `${startLabel} — ${endLabel}`;
}

export function formatDuration(start: string, end: string | null): string {
  if (isPlaceholder(start)) return "";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  if (Number.isNaN(startDate.getTime())) return "";

  const months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth());
  const years = Math.floor(months / 12);
  const remMonths = months % 12;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years > 1 ? "s" : ""}`);
  if (remMonths > 0 || years === 0) parts.push(`${remMonths} mo${remMonths !== 1 ? "s" : ""}`);
  return parts.join(" ");
}
