import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { documentUpdateInput } from "../../src/shared/schemas/document";
import { createDb, schema } from "../../src/worker/db/client";
import { AppError } from "../../src/worker/errors";
import {
  buildSnapshot,
  convertQuote,
  decideQuote,
  deleteDraft,
  duplicateDocument,
  finalize,
  getRevision,
  listDocuments,
  loadDocument,
  markSent,
  revise,
  updateDraft,
  voidDocument,
} from "../../src/worker/services/documents";
import type { Fetcher } from "../../src/worker/services/fx";
import { recordPayment } from "../../src/worker/services/payments";
import {
  activityTypes,
  counterValue,
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  seedTaxRate,
  sentInvoice,
  TODAY,
} from "../helpers/documents";

async function expectAppError(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  expect((err as AppError).code).toBe(code);
}

let clientId: string;

beforeEach(async () => {
  await resetDocuments();
  clientId = (await seedClient()).id;
});

describe("drafts and numbering", () => {
  it("a draft has no number, and finalize assigns INV-0001 with revision 1", async () => {
    const tax = await seedTaxRate("15");
    const id = await draft({
      clientId,
      lines: [{ description: "Design", quantity: "2", unitPrice: 100000, taxRateId: tax.id }],
    });
    const before = await loadDocument(db, id);
    expect(before.number).toBeNull();
    expect(before.status).toBe("draft");
    expect(before.total).toBe(230000);

    const result = await finalize(db, id, { now: NOW, fetcher: noFetch });
    expect(result.allocated).toBe(true);
    expect(result.document.number).toBe("INV-0001");
    expect(result.document.status).toBe("finalized");
    expect(result.document.issueDate).toBe(TODAY);
    expect(result.document.dueDate).toBe("2026-11-06");
    expect(result.document.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(result.revision.revisionNumber).toBe(1);
    expect(result.revision.total).toBe(230000);
    expect(result.revision.homeTotal).toBe(230000);

    const { snapshot } = await getRevision(db, result.revision.id);
    expect(snapshot.document.number).toBe("INV-0001");
    expect(snapshot.lines[0]?.tax?.name).toBe("VAT 15%");
    expect(snapshot.client.name).toBe("Northwind");
    expect(snapshot.client.contact?.email).toBe("ap@northwind.test");
    expect(snapshot.brandKit.businessName).toBe("Studio One");
    expect(snapshot.template.config.layout).toBe("classic");

    const taxRows = await db
      .select()
      .from(schema.revisionTaxTotals)
      .where(eq(schema.revisionTaxTotals.revisionId, result.revision.id));
    expect(taxRows).toMatchObject([{ taxRateId: tax.id, taxable: 200000, tax: 30000 }]);
  });

  it("finalize is idempotent and does not use a second number", async () => {
    const id = await draft({ clientId });
    const first = await finalize(db, id, { now: NOW, fetcher: noFetch });
    const second = await finalize(db, id, { now: NOW, fetcher: noFetch });
    expect(second.allocated).toBe(false);
    expect(second.revision.id).toBe(first.revision.id);
    expect(await counterValue("invoice")).toBe(1);
  });

  it("two finalize calls racing get distinct consecutive numbers", async () => {
    const a = await draft({ clientId });
    const b = await draft({ clientId });
    const results = await Promise.all([
      finalize(db, a, { now: NOW, fetcher: noFetch }),
      finalize(db, b, { now: NOW, fetcher: noFetch }),
    ]);
    const numbers = results.map((r) => r.document.number).sort();
    expect(numbers).toEqual(["INV-0001", "INV-0002"]);
    expect(await counterValue("invoice")).toBe(2);
  });

  it("two finalize calls racing on one document assign one number", async () => {
    const id = await draft({ clientId });
    const results = await Promise.all([
      finalize(db, id, { now: NOW, fetcher: noFetch }),
      finalize(db, id, { now: NOW, fetcher: noFetch }),
    ]);
    expect(results.filter((r) => r.allocated)).toHaveLength(1);
    expect(new Set(results.map((r) => r.revision.id)).size).toBe(1);
    expect(await counterValue("invoice")).toBe(1);
    const revisions = await db
      .select()
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.documentId, id));
    expect(revisions).toHaveLength(1);
    expect(await activityTypes(id)).toEqual(["created", "finalized"]);
  });

  it("deleting a draft never leaves a gap in the numbering", async () => {
    const first = await draft({ clientId });
    const deleted = await draft({ clientId });
    const third = await draft({ clientId });
    await finalize(db, first, { now: NOW, fetcher: noFetch });
    await deleteDraft(db, deleted);
    const result = await finalize(db, third, { now: NOW, fetcher: noFetch });
    expect(result.document.number).toBe("INV-0002");
    await expectAppError(loadDocument(db, deleted), 404, "document_not_found");
  });

  it("a finalized invoice cannot be deleted or edited", async () => {
    const id = await draft({ clientId });
    await finalize(db, id, { now: NOW, fetcher: noFetch });
    await expectAppError(deleteDraft(db, id), 409, "document_locked");
    await expectAppError(
      updateDraft(db, id, documentUpdateInput.parse({ notes: "x" }), { now: NOW }),
      409,
      "document_locked",
    );
  });

  it("quotes use their own sequence and stay draft with a number until sent", async () => {
    const id = await draft({ clientId, kind: "quote" });
    const result = await finalize(db, id, { now: NOW, fetcher: noFetch });
    expect(result.document.number).toBe("Q-0001");
    expect(result.document.status).toBe("draft");
    expect(result.document.expiryDate).toBe("2026-11-22");
    await expectAppError(deleteDraft(db, id), 409, "document_locked");
    const sent = await markSent(db, id, { revisionId: result.revision.id, now: NOW });
    expect(sent.status).toBe("sent");
    expect(await counterValue("invoice")).toBe(0);
  });
});

describe("exchange rates at finalize", () => {
  const failing: Fetcher = async () => new Response("down", { status: 503 });

  it("throws fx_rate_required before allocating a number", async () => {
    const id = await draft({ clientId, currency: "USD" });
    await expectAppError(finalize(db, id, { now: NOW, fetcher: failing }), 409, "fx_rate_required");
    expect(await counterValue("invoice")).toBe(0);
    const doc = await loadDocument(db, id);
    expect(doc.number).toBeNull();
    expect(doc.status).toBe("draft");
  });

  it("keeps a manual rate override and does not fetch", async () => {
    const id = await draft({ clientId, currency: "EUR", fxRate: { rate: "130.00", date: TODAY } });
    const result = await finalize(db, id, { now: NOW, fetcher: noFetch });
    expect(result.document.fxRate).toBe("130");
    expect(result.document.fxProvider).toBe("manual");
    expect(result.revision.fxRate).toBe("130");
    expect(result.revision.homeTotal).toBe(26000000);
  });

  it("fetches the rate for the issue date when there is no override", async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return Response.json({ date: "2026-10-22", base: "USD", quote: "BDT", rate: 122.5 });
    };
    const id = await draft({ clientId, currency: "USD" });
    const result = await finalize(db, id, { now: NOW, fetcher, issueDate: "2026-10-22" });
    expect(calls).toHaveLength(1);
    expect(result.document.fxRate).toBe("122.5");
    expect(result.document.fxProvider).toBe("frankfurter");
    expect(result.revision.homeTotal).toBe(24500000);
  });
});

describe("snapshots", () => {
  it("a sent snapshot stays frozen when the brand kit changes (AE5 data part)", async () => {
    await env.DB.prepare(
      "UPDATE workspace SET logo_key = 'logos/old.png', business_name = 'Old Name'",
    ).run();
    const id = await draft({ clientId });
    const { revision } = await finalize(db, id, { now: NOW, fetcher: noFetch });
    await env.DB.prepare(
      "UPDATE workspace SET logo_key = 'logos/new.png', business_name = 'New Name'",
    ).run();

    const { snapshot } = await getRevision(db, revision.id);
    expect(snapshot.brandKit.businessName).toBe("Old Name");
    expect(snapshot.brandKit.logoUrl).toBe("/p/assets/logo/old.png");

    const preview = await buildSnapshot(db, id, { now: NOW });
    expect(preview.brandKit.businessName).toBe("New Name");
    expect(preview.brandKit.logoUrl).toBe("/p/assets/logo/new.png");
  });

  it("a draft preview has no number and allocates nothing", async () => {
    const id = await draft({ clientId });
    const preview = await buildSnapshot(db, id, { now: NOW });
    expect(preview.document.number).toBeNull();
    expect(preview.document.revisionNumber).toBe(0);
    expect(preview.totals.total).toBe(200000);
    expect(await counterValue("invoice")).toBe(0);
  });
});

describe("revise and void", () => {
  it("revising a sent invoice writes revision 2 with the same number and a new snapshot", async () => {
    const id = await sentInvoice({ clientId });
    const result = await revise(
      db,
      id,
      documentUpdateInput.parse({
        lines: [{ description: "Design, revised", quantity: "3", unitPrice: 100000 }],
      }),
      { now: NOW + 1000, fetcher: noFetch },
    );
    expect(result.revision.revisionNumber).toBe(2);
    expect(result.document.number).toBe("INV-0001");
    expect(result.document.status).toBe("sent");
    expect(result.document.total).toBe(300000);
    expect(result.document.revisionCount).toBe(2);
    expect(result.document.currentRevisionId).toBe(result.revision.id);
    const { snapshot } = await getRevision(db, result.revision.id);
    expect(snapshot.document.number).toBe("INV-0001");
    expect(snapshot.lines[0]?.description).toBe("Design, revised");
    expect(snapshot.totals.total).toBe(300000);
    expect(await counterValue("invoice")).toBe(1);
  });

  it("an overdue invoice can be revised", async () => {
    const id = await sentInvoice({ clientId, dueDate: "2026-10-01", issueDate: "2026-09-20" });
    const result = await revise(db, id, documentUpdateInput.parse({ notes: "Thanks" }), {
      now: NOW,
      fetcher: noFetch,
    });
    expect(result.revision.revisionNumber).toBe(2);
    expect(result.document.isOverdue).toBe(true);
  });

  it("revise after a payment is rejected", async () => {
    const id = await sentInvoice({ clientId });
    await recordPayment(db, id, { amount: 1000, paidOn: TODAY }, { now: NOW });
    await expectAppError(
      revise(db, id, documentUpdateInput.parse({ notes: "x" }), { now: NOW, fetcher: noFetch }),
      409,
      "revise_not_allowed",
    );
  });

  it("void with payments is rejected, and void without payments works", async () => {
    const paid = await sentInvoice({ clientId });
    await recordPayment(db, paid, { amount: 1000, paidOn: TODAY }, { now: NOW });
    await expectAppError(voidDocument(db, paid, { now: NOW }), 409, "void_has_payments");

    const open = await sentInvoice({ clientId });
    const voided = await voidDocument(db, open, { now: NOW });
    expect(voided.status).toBe("void");
    expect(voided.number).toBe("INV-0002");
  });

  it("a finalized invoice (failed send) can be voided and keeps its number", async () => {
    const id = await draft({ clientId });
    await finalize(db, id, { now: NOW, fetcher: noFetch });
    const voided = await voidDocument(db, id, { now: NOW });
    expect(voided.status).toBe("void");
    expect(voided.number).toBe("INV-0001");
  });

  it("a draft cannot be voided", async () => {
    const id = await draft({ clientId });
    await expectAppError(voidDocument(db, id, { now: NOW }), 409, "invalid_status");
  });
});

describe("exchange rates and custom fields on edits", () => {
  const usd122: Fetcher = async () =>
    Response.json({ date: "2026-10-23", base: "USD", quote: "BDT", rate: 122.5 });

  it("a currency change on a draft clears the manual rate", async () => {
    const id = await draft({ clientId, currency: "EUR", fxRate: { rate: "130", date: TODAY } });
    await updateDraft(db, id, documentUpdateInput.parse({ currency: "USD" }), { now: NOW });
    const doc = await loadDocument(db, id);
    expect(doc.currency).toBe("USD");
    expect(doc.fxRate).toBeNull();
    expect(doc.fxProvider).toBeNull();
    expect(doc.fxOverridden).toBe(false);
  });

  it("a currency change with a new manual rate keeps the new rate", async () => {
    const id = await draft({ clientId, currency: "EUR", fxRate: { rate: "130", date: TODAY } });
    await updateDraft(
      db,
      id,
      documentUpdateInput.parse({ currency: "USD", fxRate: { rate: "122", date: TODAY } }),
      { now: NOW },
    );
    const doc = await loadDocument(db, id);
    expect(doc.fxRate).toBe("122");
    expect(doc.fxOverridden).toBe(true);
  });

  it("rejects a manual rate other than 1 for the home currency", async () => {
    await expectAppError(
      draft({ clientId, currency: "BDT", fxRate: { rate: "2", date: TODAY } }),
      422,
      "invalid_fx_rate",
    );
    const id = await draft({ clientId, currency: "EUR", fxRate: { rate: "130", date: TODAY } });
    await expectAppError(
      updateDraft(
        db,
        id,
        documentUpdateInput.parse({ currency: "BDT", fxRate: { rate: "130", date: TODAY } }),
        { now: NOW },
      ),
      422,
      "invalid_fx_rate",
    );
    const sent = await sentInvoice({ clientId });
    await expectAppError(
      revise(db, sent, documentUpdateInput.parse({ fxRate: { rate: "3", date: TODAY } }), {
        now: NOW,
        fetcher: noFetch,
      }),
      422,
      "invalid_fx_rate",
    );
    const one = await draft({ clientId, currency: "BDT", fxRate: { rate: "1.0", date: TODAY } });
    expect((await loadDocument(db, one)).fxRate).toBe("1");
  });

  it("revise refetches the rate after a currency change, even over a manual rate", async () => {
    const id = await sentInvoice({
      clientId,
      currency: "EUR",
      fxRate: { rate: "130", date: TODAY },
    });
    const result = await revise(db, id, documentUpdateInput.parse({ currency: "USD" }), {
      now: NOW,
      fetcher: usd122,
    });
    expect(result.document.currency).toBe("USD");
    expect(result.document.fxRate).toBe("122.5");
    expect(result.document.fxProvider).toBe("frankfurter");
    expect(result.document.fxOverridden).toBe(false);
    expect(result.revision.fxRate).toBe("122.5");
  });

  it("the revised snapshot uses the new document custom field values", async () => {
    const [field] = await db
      .insert(schema.customFieldDefs)
      .values({ label: "PO number", type: "text", scope: "document", section: "header" })
      .returning();
    if (!field) throw new Error("field insert failed");
    const id = await sentInvoice({
      clientId,
      customFields: [{ fieldId: field.id, value: "PO-1" }],
    });
    const result = await revise(
      db,
      id,
      documentUpdateInput.parse({ customFields: [{ fieldId: field.id, value: "PO-2" }] }),
      { now: NOW, fetcher: noFetch },
    );
    const { snapshot } = await getRevision(db, result.revision.id);
    expect(snapshot.customFields.map((f) => f.value)).toEqual(["PO-2"]);

    const cleared = await revise(db, id, documentUpdateInput.parse({ customFields: [] }), {
      now: NOW,
      fetcher: noFetch,
    });
    expect((await getRevision(db, cleared.revision.id)).snapshot.customFields).toEqual([]);
  });
});

describe("duplicate and convert", () => {
  it("duplicate copies lines into a new draft with no number", async () => {
    const id = await sentInvoice({ clientId });
    const copyId = await duplicateDocument(db, id, { now: NOW });
    const copy = await loadDocument(db, copyId);
    expect(copy.status).toBe("draft");
    expect(copy.number).toBeNull();
    expect(copy.total).toBe(200000);
    const lines = await db
      .select()
      .from(schema.documentLines)
      .where(eq(schema.documentLines.documentId, copyId));
    expect(lines).toHaveLength(1);
    expect(await activityTypes(copyId)).toEqual(["duplicated"]);
  });

  it("converting an accepted quote creates one draft invoice, and a second convert fails (AE6)", async () => {
    const quoteId = await draft({
      clientId,
      kind: "quote",
      lines: [
        { description: "Phase 1", quantity: "1", unitPrice: 50000 },
        { description: "Phase 2", quantity: "2", unitPrice: 25000 },
      ],
    });
    const { revision, document } = await finalize(db, quoteId, { now: NOW, fetcher: noFetch });
    await markSent(db, quoteId, { revisionId: revision.id, now: NOW });
    const token = document.publicToken ?? "";
    const accepted = await decideQuote(db, token, { decision: "accept" }, { now: NOW });
    expect(accepted.status).toBe("accepted");

    const invoiceId = await convertQuote(db, quoteId, { now: NOW });
    const invoice = await loadDocument(db, invoiceId);
    expect(invoice).toMatchObject({
      kind: "invoice",
      status: "draft",
      number: null,
      sourceQuoteId: quoteId,
      total: 100000,
    });
    const lines = await db
      .select()
      .from(schema.documentLines)
      .where(eq(schema.documentLines.documentId, invoiceId));
    expect(lines.map((l) => l.description).sort()).toEqual(["Phase 1", "Phase 2"]);
    const quote = await loadDocument(db, quoteId);
    expect(quote.status).toBe("converted");
    expect(quote.convertedInvoiceId).toBe(invoiceId);

    await expectAppError(convertQuote(db, quoteId, { now: NOW }), 409, "already_converted");
    const invoices = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.sourceQuoteId, quoteId));
    expect(invoices).toHaveLength(1);
  });

  it("two converts racing create one invoice", async () => {
    const quoteId = await draft({ clientId, kind: "quote" });
    const { revision, document } = await finalize(db, quoteId, { now: NOW, fetcher: noFetch });
    await markSent(db, quoteId, { revisionId: revision.id, now: NOW });
    await decideQuote(db, document.publicToken ?? "", { decision: "accept" }, { now: NOW });
    const results = await Promise.allSettled([
      convertQuote(db, quoteId, { now: NOW }),
      convertQuote(db, quoteId, { now: NOW }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const invoices = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.sourceQuoteId, quoteId));
    expect(invoices).toHaveLength(1);
  });
});

describe("quote decisions", () => {
  async function sentQuote(expiryDate: string) {
    const id = await draft({ clientId, kind: "quote", expiryDate });
    const { revision, document } = await finalize(db, id, { now: NOW, fetcher: noFetch });
    await markSent(db, id, { revisionId: revision.id, now: NOW });
    return { id, token: document.publicToken ?? "" };
  }

  it("accept after expiry is rejected and does not change the status", async () => {
    const { id, token } = await sentQuote("2026-10-22");
    await expectAppError(
      decideQuote(db, token, { decision: "accept" }, { now: NOW }),
      409,
      "quote_expired",
    );
    expect((await loadDocument(db, id)).status).toBe("sent");
  });

  it("a decision is final", async () => {
    const { token } = await sentQuote("2026-10-30");
    const declined = await decideQuote(
      db,
      token,
      { decision: "decline", comment: "Too expensive" },
      { now: NOW },
    );
    expect(declined.status).toBe("declined");
    expect(declined.decisionComment).toBe("Too expensive");
    await expectAppError(
      decideQuote(db, token, { decision: "accept" }, { now: NOW }),
      409,
      "quote_decided",
    );
  });

  it("stores the decision and its notification job in one batch", async () => {
    const { id, token } = await sentQuote("2026-10-30");
    const job = () => ({
      type: "test.decision",
      idempotencyKey: `decision:${id}`,
      payload: { id },
    });

    // The job insert fails, so the decision must not be stored either.
    const failing = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (query: string) => {
            if (query.includes("INSERT INTO jobs")) throw new Error("jobs insert failed");
            return target.prepare(query);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      decideQuote(createDb(failing), token, { decision: "accept" }, { now: NOW, job }),
    ).rejects.toThrow("jobs insert failed");
    expect((await loadDocument(db, id)).status).toBe("sent");

    const accepted = await decideQuote(db, token, { decision: "accept" }, { now: NOW, job });
    expect(accepted.status).toBe("accepted");
    const rows = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.idempotencyKey, `decision:${id}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ id });
  });

  it("rejects a comment over 1000 characters and an unknown token", async () => {
    const { token } = await sentQuote("2026-10-30");
    await expectAppError(
      decideQuote(db, token, { decision: "accept", comment: "x".repeat(1001) }, { now: NOW }),
      400,
      "comment_too_long",
    );
    await expectAppError(
      decideQuote(db, "nope", { decision: "accept" }, { now: NOW }),
      404,
      "not_found",
    );
  });
});

describe("lists", () => {
  it("filters by kind, segment, and search, and derives overdue", async () => {
    await draft({ clientId });
    const overdue = await sentInvoice({ clientId, issueDate: "2026-09-01", dueDate: "2026-09-15" });
    await sentInvoice({ clientId });
    const other = (await seedClient({ name: "Contoso" })).id;
    await draft({ clientId: other, kind: "quote" });

    const all = await listDocuments(db, { kind: "invoice" }, { now: NOW });
    expect(all.total).toBe(3);
    const drafts = await listDocuments(db, { kind: "invoice", filter: "drafts" }, { now: NOW });
    expect(drafts.items.map((d) => d.status)).toEqual(["draft"]);
    const unpaid = await listDocuments(db, { filter: "unpaid" }, { now: NOW });
    expect(unpaid.total).toBe(2);
    const late = await listDocuments(db, { filter: "overdue" }, { now: NOW });
    expect(late.items.map((d) => d.id)).toEqual([overdue]);
    expect(late.items[0]?.displayStatus).toBe("overdue");
    const search = await listDocuments(db, { q: "contoso" }, { now: NOW });
    expect(search.items.map((d) => d.kind)).toEqual(["quote"]);
    const paged = await listDocuments(db, { pageSize: 2, page: 2 }, { now: NOW });
    expect(paged.items).toHaveLength(2);
    expect(paged.total).toBe(4);
  });
});

describe("activity", () => {
  it("writes one activity row per state change", async () => {
    const id = await draft({ clientId });
    await updateDraft(db, id, documentUpdateInput.parse({ notes: "Hello" }), { now: NOW });
    const { revision } = await finalize(db, id, { now: NOW, fetcher: noFetch });
    await markSent(db, id, { revisionId: revision.id, now: NOW });
    await revise(db, id, documentUpdateInput.parse({ notes: "Hello again" }), {
      now: NOW,
      fetcher: noFetch,
    });
    await voidDocument(db, id, { now: NOW });
    expect(await activityTypes(id)).toEqual([
      "created",
      "updated",
      "finalized",
      "sent",
      "revised",
      "voided",
    ]);
  });
});
