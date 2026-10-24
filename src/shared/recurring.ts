// Recurring period math (U15). All dates are ISO dates in the workspace timezone
// (Asia/Dhaka). The scheduler turns "today" into a workspace date before it calls these.
import type { RecurringFrequency } from "./domain";
import { addDays, isIsoDate } from "./time";

export interface PeriodRule {
  frequency: RecurringFrequency;
  /** The first issue date. */
  startDate: string;
  /** The day of month the schedule is anchored on. 29 to 31 fall back to the month end. */
  anchorDay: number;
}

const MONTHS: Record<Exclude<RecurringFrequency, "weekly">, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

function parts(isoDate: string): [number, number, number] {
  if (!isIsoDate(isoDate)) throw new RangeError(`Invalid date: ${isoDate}`);
  return isoDate.split("-").map(Number) as [number, number, number];
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The number of days in a month (`month` is 1 to 12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The anchor day of a start date. */
export function anchorDayOf(startDate: string): number {
  return parts(startDate)[2];
}

/**
 * The issue date of occurrence `index` (0 is the start date). Monthly, quarterly, and
 * yearly dates use the anchor day, or the last day of a shorter month (R51):
 * Jan 31 -> Feb 28 (Feb 29 in a leap year) -> Mar 31.
 */
export function occurrenceDate(rule: PeriodRule, index: number): string {
  if (rule.frequency === "weekly") return addDays(rule.startDate, 7 * index);
  const [year, month] = parts(rule.startDate);
  const total = month - 1 + index * MONTHS[rule.frequency];
  const y = year + Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(rule.anchorDay, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The ISO 8601 week of a date, for example "2026-W43". */
export function isoWeek(isoDate: string): string {
  const [y, m, d] = parts(isoDate);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7;
  // The Thursday of this week decides the ISO year.
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${pad(week)}`;
}

/**
 * The billing period of an issue date. It is the job key, so an edit to the schedule
 * (a new start date or anchor day) never creates a second invoice for the same period.
 * weekly "2026-W43", monthly "2026-10", quarterly "2026-Q4", yearly "2026".
 */
export function periodId(frequency: RecurringFrequency, issueDate: string): string {
  const [y, m] = parts(issueDate);
  switch (frequency) {
    case "weekly":
      return isoWeek(issueDate);
    case "monthly":
      return `${y}-${pad(m)}`;
    case "quarterly":
      return `${y}-Q${Math.ceil(m / 3)}`;
    case "yearly":
      return String(y);
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The index of the first occurrence on or after `date`. */
export function firstIndexOnOrAfter(rule: PeriodRule, date: string): number {
  if (date <= rule.startDate) return 0;
  let index: number;
  if (rule.frequency === "weekly") {
    index = Math.ceil(daysBetween(rule.startDate, date) / 7);
  } else {
    const [sy, sm] = parts(rule.startDate);
    const [y, m] = parts(date);
    index = Math.max(0, Math.floor((y * 12 + m - (sy * 12 + sm)) / MONTHS[rule.frequency]));
  }
  while (index > 0 && occurrenceDate(rule, index - 1) >= date) index -= 1;
  while (occurrenceDate(rule, index) < date) index += 1;
  return index;
}

/** The issue date that follows `issueDate`. */
export function occurrenceAfter(rule: PeriodRule, issueDate: string): string {
  return occurrenceDate(rule, firstIndexOnOrAfter(rule, addDays(issueDate, 1)));
}

export interface DuePeriod {
  issueDate: string;
  periodId: string;
}

/**
 * The periods due from `from` up to and including `today`, stopping at the end date.
 * `limit` caps one call, so a long outage catches up over a few ticks.
 */
export function duePeriods(
  rule: PeriodRule & { endDate: string | null },
  from: string,
  today: string,
  limit = 12,
): DuePeriod[] {
  const out: DuePeriod[] = [];
  let index = firstIndexOnOrAfter(rule, from);
  while (out.length < limit) {
    const issueDate = occurrenceDate(rule, index);
    if (issueDate > today || (rule.endDate && issueDate > rule.endDate)) break;
    out.push({ issueDate, periodId: periodId(rule.frequency, issueDate) });
    index += 1;
  }
  return out;
}

/** The next `count` issue dates on or after `from`, within the end date. */
export function upcomingDates(
  rule: PeriodRule & { endDate: string | null },
  from: string,
  count: number,
): string[] {
  const out: string[] = [];
  let index = firstIndexOnOrAfter(rule, from);
  while (out.length < count) {
    const issueDate = occurrenceDate(rule, index);
    if (rule.endDate && issueDate > rule.endDate) break;
    out.push(issueDate);
    index += 1;
  }
  return out;
}

/**
 * The next issue date after an edit or a resume: the first occurrence on or after
 * `from`, skipping the period that already has an invoice.
 */
export function nextIssueDateFrom(
  rule: PeriodRule,
  from: string,
  lastPeriodId: string | null,
): string {
  let index = firstIndexOnOrAfter(rule, from);
  let date = occurrenceDate(rule, index);
  // Period IDs of one frequency sort as text. After a frequency change the formats
  // differ, and the old period cannot collide with a new one.
  const comparable = lastPeriodId !== null && PERIOD_FORMATS[rule.frequency].test(lastPeriodId);
  while (comparable && periodId(rule.frequency, date) <= (lastPeriodId as string)) {
    index += 1;
    date = occurrenceDate(rule, index);
  }
  return date;
}

const PERIOD_FORMATS: Record<RecurringFrequency, RegExp> = {
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/,
  quarterly: /^\d{4}-Q\d$/,
  yearly: /^\d{4}$/,
};
