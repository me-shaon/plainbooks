// Business dates. All business dates are ISO text (YYYY-MM-DD) in the workspace timezone.
// Cron and D1 timestamps stay in UTC milliseconds.

export const WORKSPACE_TIMEZONE = "Asia/Dhaka";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws RangeError for an unknown timezone.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Returns the calendar date (YYYY-MM-DD) in `timeZone` at the instant `now`. */
export function todayIn(timeZone: string, now: Date | number = Date.now()): string {
  const parts = formatterFor(timeZone).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** Adds whole days to an ISO date. Negative values go back. */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`Invalid date: ${isoDate}`);
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
