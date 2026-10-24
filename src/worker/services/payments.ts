// Payments and write-offs. Each change writes the payment row, one activity row, and the
// recomputed cached amount_paid, status, and overdue flag on the invoice, in one D1 batch.
import { and, eq } from "drizzle-orm";
import { convertMinor } from "../../shared/money";
import { OPEN_STATUSES } from "../../shared/schemas/document";
import { type Db, schema } from "../db/client";
import type { Document } from "../db/schema";
import { AppError } from "../errors";
import { guardedActivity } from "./activity";
import { type ActionContext, loadDocument, loadWorkspace, workspaceToday } from "./documents";
import { OPEN_STATUS_LIST, sqlInList } from "./status-sql";

const { payments } = schema;

const PAYABLE_OR_PAID = sqlInList([...OPEN_STATUSES, "paid"]);
const PAID_SUM = "(SELECT coalesce(sum(amount), 0) FROM payments WHERE document_id = ?1)";

/**
 * Recomputes the cached payment state from the payment rows:
 * paid when payments cover the total, partially paid when some exist, else sent. The
 * overdue flag follows the due date (?2 is today in the workspace timezone).
 */
function recomputeStatement(d1: D1Database, documentId: string, today: string, now: number) {
  return d1
    .prepare(
      `UPDATE documents SET
         amount_paid = ${PAID_SUM},
         status = CASE WHEN ${PAID_SUM} > 0 AND ${PAID_SUM} >= total THEN 'paid'
                       WHEN ${PAID_SUM} > 0 THEN 'partially_paid' ELSE 'sent' END,
         paid_at = CASE WHEN ${PAID_SUM} > 0 AND ${PAID_SUM} >= total THEN coalesce(paid_at, ?3)
                        ELSE NULL END,
         is_overdue = CASE WHEN ${PAID_SUM} < total AND due_date IS NOT NULL AND due_date < ?2
                           THEN 1 ELSE 0 END,
         updated_at = ?3
       WHERE id = ?1 AND kind = 'invoice' AND status IN (${PAYABLE_OR_PAID})`,
    )
    .bind(documentId, today, now);
}

function insertPayment(
  d1: D1Database,
  values: {
    id: string;
    documentId: string;
    kind: "payment" | "write_off";
    amount: number;
    homeAmount: number;
    paidOn: string;
    note: string | null;
    createdBy: string | null;
    now: number;
  },
  guard: string,
  guardParams: unknown[],
) {
  return d1
    .prepare(
      `INSERT INTO payments (id, document_id, kind, amount, home_amount, paid_on, note, created_by, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
    )
    .bind(
      values.id,
      values.documentId,
      values.kind,
      values.amount,
      values.homeAmount,
      values.paidOn,
      values.note,
      values.createdBy,
      values.now,
      ...guardParams,
    );
}

function balanceOf(doc: Document): number {
  return doc.total - doc.amountPaid;
}

function assertInvoiceOpen(doc: Document): void {
  if (doc.kind !== "invoice") {
    throw new AppError(409, "invalid_status", "Payments apply to invoices only");
  }
  if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) {
    throw new AppError(409, "invalid_status", "Record payments on a sent, unpaid invoice");
  }
}

/** Records a payment. A payment above the open balance is blocked (R44). */
export async function recordPayment(
  db: Db,
  documentId: string,
  input: { amount: number; paidOn: string; note?: string | null },
  ctx: ActionContext,
): Promise<Document> {
  const doc = await loadDocument(db, documentId);
  assertInvoiceOpen(doc);
  if (input.amount > balanceOf(doc)) {
    throw new AppError(422, "overpayment", "The payment is more than the open balance");
  }
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, ctx.now);
  const homeAmount = convertMinor(input.amount, doc.currency, ws.homeCurrency, doc.fxRate ?? "1");
  const d1 = db.$client;
  const paymentId = crypto.randomUUID();
  const results = await d1.batch([
    insertPayment(
      d1,
      {
        id: paymentId,
        documentId,
        kind: "payment",
        amount: input.amount,
        homeAmount,
        paidOn: input.paidOn,
        note: input.note ?? null,
        createdBy: ctx.actor?.id ?? null,
        now: ctx.now,
      },
      `EXISTS (SELECT 1 FROM documents WHERE id = ? AND kind = 'invoice'
        AND status IN (${OPEN_STATUS_LIST}) AND amount_paid + ? <= total)`,
      [documentId, input.amount],
    ),
    guardedActivity(
      d1,
      {
        documentId,
        clientId: doc.clientId,
        type: "payment_recorded",
        actorUserId: ctx.actor?.id ?? null,
        data: { paymentId, amount: input.amount, paidOn: input.paidOn },
        now: ctx.now,
      },
      "EXISTS (SELECT 1 FROM payments WHERE id = ?)",
      [paymentId],
    ),
    recomputeStatement(d1, documentId, today, ctx.now),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    const current = await loadDocument(db, documentId);
    assertInvoiceOpen(current);
    throw new AppError(422, "overpayment", "The payment is more than the open balance");
  }
  return loadDocument(db, documentId);
}

/**
 * Writes off the remainder of a partially paid invoice (R44). Records a `write_off`
 * entry for the balance and marks the invoice paid.
 */
export async function writeOffRemainder(
  db: Db,
  documentId: string,
  input: { paidOn?: string; note?: string | null },
  ctx: ActionContext,
): Promise<Document> {
  const doc = await loadDocument(db, documentId);
  if (doc.kind !== "invoice" || doc.status !== "partially_paid") {
    throw new AppError(409, "invalid_status", "Only a partially paid invoice can be written off");
  }
  const amount = balanceOf(doc);
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, ctx.now);
  const homeAmount = convertMinor(amount, doc.currency, ws.homeCurrency, doc.fxRate ?? "1");
  const d1 = db.$client;
  const paymentId = crypto.randomUUID();
  const results = await d1.batch([
    insertPayment(
      d1,
      {
        id: paymentId,
        documentId,
        kind: "write_off",
        amount,
        homeAmount,
        paidOn: input.paidOn ?? today,
        note: input.note ?? null,
        createdBy: ctx.actor?.id ?? null,
        now: ctx.now,
      },
      `EXISTS (SELECT 1 FROM documents WHERE id = ? AND status = 'partially_paid' AND amount_paid = ?)`,
      [documentId, doc.amountPaid],
    ),
    guardedActivity(
      d1,
      {
        documentId,
        clientId: doc.clientId,
        type: "written_off",
        actorUserId: ctx.actor?.id ?? null,
        data: { paymentId, amount },
        now: ctx.now,
      },
      "EXISTS (SELECT 1 FROM payments WHERE id = ?)",
      [paymentId],
    ),
    recomputeStatement(d1, documentId, today, ctx.now),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw new AppError(409, "write_off_conflict", "The invoice changed. Reload and try again");
  }
  return loadDocument(db, documentId);
}

/**
 * Deletes a payment or write-off and recomputes the status: paid, partially paid, or sent
 * (shown as overdue when past due).
 */
export async function deletePayment(
  db: Db,
  documentId: string,
  paymentId: string,
  ctx: ActionContext,
): Promise<Document> {
  const doc = await loadDocument(db, documentId);
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.documentId, documentId)));
  if (!payment) throw new AppError(404, "payment_not_found", "This payment does not exist");
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, ctx.now);
  const d1 = db.$client;
  await d1.batch([
    guardedActivity(
      d1,
      {
        documentId,
        clientId: doc.clientId,
        type: "payment_deleted",
        actorUserId: ctx.actor?.id ?? null,
        data: { paymentId, kind: payment.kind, amount: payment.amount, paidOn: payment.paidOn },
        now: ctx.now,
      },
      "EXISTS (SELECT 1 FROM payments WHERE id = ? AND document_id = ?)",
      [paymentId, documentId],
    ),
    d1.prepare("DELETE FROM payments WHERE id = ? AND document_id = ?").bind(paymentId, documentId),
    recomputeStatement(d1, documentId, today, ctx.now),
  ]);
  return loadDocument(db, documentId);
}
