// Gap-free document numbers. D1 has no interactive transactions, so allocation is two
// conditional statements inside the finalize batch:
// 1. increment the counter only while the document is still an unnumbered draft;
// 2. write the number, read from the counter, under the same condition.
// The batch is atomic and batches run one at a time, so racing finalize calls get distinct,
// consecutive numbers, and a lost race changes nothing.
import type { DocumentKind } from "../../shared/domain";

/** The SQL condition for "this document can still get a number". Binds the document ID. */
export const UNNUMBERED_DRAFT = "status = 'draft' AND number IS NULL";

/** Counter row name per kind. The seed migration creates both rows. */
export function counterName(kind: DocumentKind): string {
  return kind;
}

/** Formats a number in JS, the same way the SQL does. For previews and tests. */
export function formatDocumentNumber(prefix: string, padding: number, value: number): string {
  return `${prefix}${String(value).padStart(padding, "0")}`;
}

/** Step 1: increments the counter if the document is still an unnumbered draft. */
export function counterIncrement(
  d1: D1Database,
  kind: DocumentKind,
  documentId: string,
): D1PreparedStatement {
  return d1
    .prepare(
      `UPDATE counters SET value = value + 1 WHERE name = ?
       AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND ${UNNUMBERED_DRAFT})`,
    )
    .bind(counterName(kind), documentId);
}

/**
 * Step 2: an SQL expression for the new number, plus its parameters. Use it in the SET list
 * of the document UPDATE that runs right after `counterIncrement` in the same batch.
 */
export function numberExpression(
  kind: DocumentKind,
  prefix: string,
  padding: number,
): { sql: string; params: unknown[] } {
  const width = Math.max(1, Math.min(12, Math.trunc(padding)));
  return {
    sql: "(? || printf(?, (SELECT value FROM counters WHERE name = ?)))",
    params: [prefix, `%0${width}d`, counterName(kind)],
  };
}
