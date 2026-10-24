// SQL forms of the shared status rules in src/shared/schemas/document.ts. Every query that
// filters open or overdue invoices builds its predicate here, so the SQL and `isOverdue`
// stay the same rule.
import { type SQL, sql } from "drizzle-orm";
import { OPEN_STATUSES } from "../../shared/schemas/document";

/** The body of a SQL IN list, for example `'sent', 'partially_paid'`. */
export function sqlInList(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

/** `OPEN_STATUSES` as the body of a SQL IN list. */
export const OPEN_STATUS_LIST = sqlInList(OPEN_STATUSES);

/**
 * Open invoices: sent or partially paid, with a balance above zero. `prefix` qualifies the
 * columns, for example "d." for an alias.
 */
export function openInvoiceCondition(prefix = ""): string {
  return `(${prefix}kind = 'invoice' AND ${prefix}status IN (${OPEN_STATUS_LIST}) AND ${prefix}total - ${prefix}amount_paid > 0)`;
}

/**
 * The raw SQL form of `isOverdue`: an open invoice with a due date before `today`.
 * `today` is a SQL expression, for example a placeholder such as "?1".
 */
export function overdueCondition(today: string, prefix = ""): string {
  return `(${openInvoiceCondition(prefix)} AND ${prefix}due_date IS NOT NULL AND ${prefix}due_date < ${today})`;
}

/** `overdueCondition` for Drizzle queries, with `today` (YYYY-MM-DD) bound as a parameter. */
export function overdueSql(today: string, prefix = ""): SQL {
  const marker = "\u0000today\u0000";
  const [before = "", after = ""] = overdueCondition(marker, prefix).split(marker);
  return sql`${sql.raw(before)}${today}${sql.raw(after)}`;
}
