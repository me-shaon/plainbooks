import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "../../src/worker/db/client";
import { AppError } from "../../src/worker/errors";
import { getDocumentDetail, loadDocument } from "../../src/worker/services/documents";
import {
  deletePayment,
  markPaid,
  recordPayment,
  writeOffRemainder,
} from "../../src/worker/services/payments";
import {
  activityTypes,
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  sentInvoice,
  TODAY,
} from "../helpers/documents";

let clientId: string;

beforeEach(async () => {
  await resetDocuments();
  clientId = (await seedClient()).id;
});

async function paymentIds(documentId: string) {
  const rows = await db
    .select({ id: schema.payments.id, kind: schema.payments.kind, amount: schema.payments.amount })
    .from(schema.payments)
    .where(eq(schema.payments.documentId, documentId));
  return rows;
}

describe("payments", () => {
  it("a payment of 500.00 on a 2,000.00 invoice gives partially paid with 1,500.00 open (AE7)", async () => {
    const id = await sentInvoice({ clientId });
    const doc = await recordPayment(db, id, { amount: 50000, paidOn: TODAY }, { now: NOW });
    expect(doc.status).toBe("partially_paid");
    expect(doc.amountPaid).toBe(50000);
    const detail = await getDocumentDetail(db, id, { now: NOW });
    expect(detail.balance).toBe(150000);
    expect(detail.displayStatus).toBe("partially_paid");
  });

  it("a payment of 1,600.00 on a balance of 1,500.00 is rejected", async () => {
    const id = await sentInvoice({ clientId });
    await recordPayment(db, id, { amount: 50000, paidOn: TODAY }, { now: NOW });
    const err = await recordPayment(db, id, { amount: 160000, paidOn: TODAY }, { now: NOW }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(422);
    expect((err as AppError).code).toBe("overpayment");
    expect((await loadDocument(db, id)).amountPaid).toBe(50000);
  });

  it("two racing payments that together overpay are not both recorded", async () => {
    const id = await sentInvoice({ clientId });
    const results = await Promise.allSettled([
      recordPayment(db, id, { amount: 150000, paidOn: TODAY }, { now: NOW }),
      recordPayment(db, id, { amount: 150000, paidOn: TODAY }, { now: NOW }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await loadDocument(db, id)).amountPaid).toBe(150000);
  });

  it("a full payment marks the invoice paid", async () => {
    const id = await sentInvoice({ clientId });
    const doc = await recordPayment(db, id, { amount: 200000, paidOn: TODAY }, { now: NOW });
    expect(doc.status).toBe("paid");
    expect(doc.paidAt).toBe(NOW);
  });

  it("writing off the remainder marks the invoice paid and records the amount", async () => {
    const id = await sentInvoice({ clientId });
    await recordPayment(db, id, { amount: 50000, paidOn: TODAY }, { now: NOW });
    const doc = await writeOffRemainder(db, id, { note: "Goodwill" }, { now: NOW });
    expect(doc.status).toBe("paid");
    expect(doc.amountPaid).toBe(200000);
    const rows = await paymentIds(id);
    expect(rows.find((r) => r.kind === "write_off")?.amount).toBe(150000);
  });

  it("deleting the only payment returns the status to sent", async () => {
    const id = await sentInvoice({ clientId });
    await recordPayment(db, id, { amount: 50000, paidOn: TODAY }, { now: NOW });
    const [payment] = await paymentIds(id);
    const doc = await deletePayment(db, id, payment?.id ?? "", { now: NOW });
    expect(doc.status).toBe("sent");
    expect(doc.amountPaid).toBe(0);
    expect(doc.isOverdue).toBe(false);
  });

  it("deleting the only payment on a past-due invoice returns it to overdue", async () => {
    const id = await sentInvoice({ clientId, issueDate: "2026-09-01", dueDate: "2026-09-15" });
    await recordPayment(db, id, { amount: 200000, paidOn: TODAY }, { now: NOW });
    const [payment] = await paymentIds(id);
    const doc = await deletePayment(db, id, payment?.id ?? "", { now: NOW });
    expect(doc.status).toBe("sent");
    expect(doc.isOverdue).toBe(true);
    const detail = await getDocumentDetail(db, id, { now: NOW });
    expect(detail.displayStatus).toBe("overdue");
  });

  it("deleting one of two payments on a paid invoice returns partially paid", async () => {
    const id = await sentInvoice({ clientId });
    await recordPayment(db, id, { amount: 50000, paidOn: TODAY }, { now: NOW });
    await recordPayment(db, id, { amount: 150000, paidOn: TODAY }, { now: NOW });
    const rows = await paymentIds(id);
    const last = rows.find((r) => r.amount === 150000);
    const doc = await deletePayment(db, id, last?.id ?? "", { now: NOW });
    expect(doc.status).toBe("partially_paid");
    expect(doc.paidAt).toBeNull();
  });

  it("each payment change writes one activity row", async () => {
    const id = await sentInvoice({ clientId });
    await recordPayment(db, id, { amount: 50000, paidOn: TODAY }, { now: NOW });
    await writeOffRemainder(db, id, {}, { now: NOW });
    const rows = await paymentIds(id);
    const writeOff = rows.find((r) => r.kind === "write_off");
    await deletePayment(db, id, writeOff?.id ?? "", { now: NOW });
    expect(await activityTypes(id)).toEqual([
      "created",
      "finalized",
      "sent",
      "payment_recorded",
      "written_off",
      "payment_deleted",
    ]);
  });
});

describe("mark paid", () => {
  it("marks a draft as sent with no email and pays the full total", async () => {
    const id = await draft({ clientId });
    const doc = await markPaid(db, id, { paidOn: "2026-10-01" }, { now: NOW, fetcher: noFetch });
    expect(doc.status).toBe("paid");
    expect(doc.number).not.toBeNull();
    expect(doc.amountPaid).toBe(200000);
    const [payment] = await paymentIds(id);
    expect(payment?.amount).toBe(200000);
    expect(await activityTypes(id)).toEqual(["created", "finalized", "sent", "payment_recorded"]);
  });

  it("records a partial amount on a draft and leaves the balance open", async () => {
    const id = await draft({ clientId });
    const doc = await markPaid(db, id, { amount: 50000 }, { now: NOW, fetcher: noFetch });
    expect(doc.status).toBe("partially_paid");
    const detail = await getDocumentDetail(db, id, { now: NOW });
    expect(detail.balance).toBe(150000);
    expect(detail.payments[0]?.paidOn).toBe(TODAY);
  });

  it("rejects an amount above the total and leaves the draft unchanged", async () => {
    const id = await draft({ clientId });
    const err = await markPaid(db, id, { amount: 300000 }, { now: NOW, fetcher: noFetch }).catch(
      (e: unknown) => e,
    );
    expect((err as AppError).code).toBe("overpayment");
    const doc = await loadDocument(db, id);
    expect(doc.status).toBe("draft");
    expect(doc.number).toBeNull();
  });

  it("pays the open balance of a partially paid invoice", async () => {
    const id = await sentInvoice({ clientId });
    await recordPayment(db, id, { amount: 50000, paidOn: TODAY }, { now: NOW });
    const doc = await markPaid(db, id, {}, { now: NOW });
    expect(doc.status).toBe("paid");
    expect((await paymentIds(id)).map((r) => r.amount).sort()).toEqual([150000, 50000]);
  });

  it("refuses an invoice that is already paid", async () => {
    const id = await sentInvoice({ clientId });
    await markPaid(db, id, {}, { now: NOW });
    const err = await markPaid(db, id, {}, { now: NOW }).catch((e: unknown) => e);
    expect((err as AppError).status).toBe(409);
  });
});
