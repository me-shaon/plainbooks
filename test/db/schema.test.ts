import { env } from "cloudflare:workers";
import { eq, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDER_SCHEDULE } from "../../src/shared/domain";
import { createDb, schema } from "../../src/worker/db/client";

const db = createDb(env.DB);

/** Drizzle wraps D1 errors. Read the driver message from the cause when present. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the query to fail").toBeInstanceOf(Error);
  const err = error as Error & { cause?: Error };
  expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(pattern);
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function seedClient() {
  const [client] = await db.insert(schema.clients).values({ name: "Northwind" }).returning();
  if (!client) throw new Error("client insert failed");
  return client;
}

async function seedInvoice(overrides: Partial<schema.NewDocument> = {}) {
  const client = await seedClient();
  const [doc] = await db
    .insert(schema.documents)
    .values({ kind: "invoice", clientId: client.id, currency: "USD", ...overrides })
    .returning();
  if (!doc) throw new Error("document insert failed");
  return doc;
}

describe("migrations", () => {
  it("create every table in the schema", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all<{ name: string }>();
    const existing = new Set(results.map((r) => r.name));
    const expected = Object.values(schema)
      .filter((value) => is(value, SQLiteTable))
      .map((table) => getTableName(table as SQLiteTable));
    expect(expected.length).toBeGreaterThanOrEqual(20);
    for (const name of expected) expect(existing, name).toContain(name);
  });

  it("seed the workspace row with BDT and Asia/Dhaka defaults", async () => {
    const rows = await db.select().from(schema.workspace);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      homeCurrency: "BDT",
      timezone: "Asia/Dhaka",
      invoicePrefix: "INV-",
      quotePrefix: "Q-",
      reminderMode: "suggest",
      recurringSendMode: "draft",
      reminderSchedule: DEFAULT_REMINDER_SCHEDULE,
      overdueReminderCap: 3,
    });
    expect(typeof rows[0]?.createdAt).toBe("number");
    const counters = await db.select().from(schema.counters);
    expect(counters.map((c) => c.name).sort()).toEqual(["invoice", "quote"]);
  });

  it("allow only one workspace row", async () => {
    await expectDbError(db.insert(schema.workspace).values({ id: 2 }), /CHECK constraint failed/);
  });
});

describe("tables accept valid rows", () => {
  it("inserts a row in every table", async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: "owner@example.com", role: "owner" })
      .returning();
    const [tax] = await db
      .insert(schema.taxRates)
      .values({ name: "VAT 15%", rate: "15", note: "Standard rate" })
      .returning();
    const [template] = await db
      .insert(schema.templates)
      .values({
        name: "Classic",
        layout: "classic",
        config: {
          layout: "classic",
          sections: [{ id: "header", visible: true }],
          customFields: [],
        },
      })
      .returning();
    const [field] = await db
      .insert(schema.customFieldDefs)
      .values({ label: "PO number", type: "text", scope: "document", section: "bill_to" })
      .returning();
    const client = await seedClient();
    await db.insert(schema.clientContacts).values([
      { clientId: client.id, email: "ap@northwind.test", isPrimary: true, isBilling: true },
      { clientId: client.id, email: "cfo@northwind.test", isBilling: true },
    ]);

    const [doc] = await db
      .insert(schema.documents)
      .values({
        kind: "invoice",
        status: "sent",
        number: "INV-0001",
        clientId: client.id,
        currency: "EUR",
        issueDate: "2026-10-01",
        dueDate: "2026-10-15",
        discountType: "percent",
        discountPercent: "5",
        templateId: template?.id,
        reminderMode: "off",
        fxRate: "130",
        fxRateScaled: 13_000_000_000,
        fxRateDate: "2026-10-01",
        fxProvider: "manual",
        fxOverridden: true,
        publicToken: token(),
        subtotal: 190000,
        discountTotal: 9500,
        taxTotal: 34295,
        total: 214795,
        createdBy: user?.id,
      })
      .returning();
    if (!doc || !tax || !field || !user) throw new Error("insert failed");

    await db.insert(schema.documentLines).values({
      documentId: doc.id,
      position: 0,
      description: "Design retainer",
      quantity: "1.5",
      unitPrice: 100000,
      taxRateId: tax.id,
    });
    await db.insert(schema.customFieldValues).values({
      fieldId: field.id,
      entityType: "document",
      entityId: doc.id,
      value: "PO-77",
    });
    const [revision] = await db
      .insert(schema.documentRevisions)
      .values({
        documentId: doc.id,
        revisionNumber: 1,
        snapshot: { number: "INV-0001", lines: [] },
        kind: "invoice",
        status: "sent",
        clientId: client.id,
        issueDate: "2026-10-01",
        dueDate: "2026-10-15",
        currency: "EUR",
        subtotal: 190000,
        discountTotal: 9500,
        taxTotal: 34295,
        total: 214795,
        homeCurrency: "BDT",
        fxRate: "130",
        homeSubtotal: 24700000,
        homeDiscountTotal: 1235000,
        homeTaxTotal: 4458350,
        homeTotal: 27923350,
      })
      .returning();
    if (!revision) throw new Error("revision insert failed");
    await db.insert(schema.revisionTaxTotals).values({
      revisionId: revision.id,
      taxRateId: tax.id,
      documentId: doc.id,
      issueDate: "2026-10-01",
      name: "VAT 15%",
      rate: "15",
      taxable: 180500,
      tax: 34295,
      homeTaxable: 23465000,
      homeTax: 4458350,
    });
    await db
      .update(schema.documents)
      .set({ currentRevisionId: revision.id, revisionCount: 1 })
      .where(eq(schema.documents.id, doc.id));

    await db.insert(schema.payments).values([
      { documentId: doc.id, amount: 50000, homeAmount: 6500000, paidOn: "2026-10-05" },
      {
        documentId: doc.id,
        kind: "write_off",
        amount: 100,
        homeAmount: 13000,
        paidOn: "2026-10-06",
      },
    ]);

    const [schedule] = await db
      .insert(schema.recurringSchedules)
      .values({
        clientId: client.id,
        currency: "USD",
        frequency: "monthly",
        startDate: "2026-01-31",
        anchorDay: 31,
        nextIssueDate: "2026-02-28",
        sendMode: "auto_send",
      })
      .returning();
    if (!schedule) throw new Error("schedule insert failed");
    await db.insert(schema.recurringScheduleLines).values({
      scheduleId: schedule.id,
      position: 0,
      description: "Hosting",
      quantity: "1",
      unitPrice: 2500,
      taxRateId: tax.id,
    });

    await db.insert(schema.jobs).values({
      type: "recurring.create",
      payload: { scheduleId: schedule.id, periodId: "2026-02" },
      idempotencyKey: `recurring:${schedule.id}:2026-02`,
    });
    await db.insert(schema.emailLog).values({
      day: "2026-10-01",
      kind: "reminder",
      trigger: "auto",
      documentId: doc.id,
      reminderOffsetDays: 7,
      recipients: ["ap@northwind.test"],
      subject: "Reminder: INV-0001",
      status: "sent",
      providerId: "re_123",
    });
    await db.insert(schema.activity).values({
      documentId: doc.id,
      clientId: client.id,
      type: "sent",
      actorUserId: user.id,
      data: { revision: 1 },
    });
    await db.insert(schema.notifications).values({
      type: "quote.accepted",
      title: "Quote accepted",
      documentId: doc.id,
    });
    await db.insert(schema.fxRates).values({
      base: "EUR",
      quote: "BDT",
      requestedDate: "2026-10-04",
      rateDate: "2026-10-02",
      rate: "128.5",
      rateScaled: 12_850_000_000,
      provider: "frankfurter",
    });
    await db.insert(schema.leases).values({ name: "browser" });

    const saved = await db.query.documents.findFirst({ where: eq(schema.documents.id, doc.id) });
    expect(saved).toMatchObject({
      status: "sent",
      fxOverridden: true,
      currentRevisionId: revision.id,
      amountPaid: 0,
      isOverdue: false,
    });
    const job = await db.query.jobs.findFirst();
    expect(job).toMatchObject({ status: "pending", attempts: 0, maxAttempts: 3 });
    expect(job?.runAfter).toBeGreaterThan(Date.now() - 60_000);
    const rev = await db.query.documentRevisions.findFirst({
      where: eq(schema.documentRevisions.id, revision.id),
    });
    expect(rev?.snapshot).toEqual({ number: "INV-0001", lines: [] });
  });

  it("accepts quote statuses on quotes", async () => {
    const client = await seedClient();
    await db
      .insert(schema.documents)
      .values({ kind: "quote", status: "accepted", clientId: client.id, currency: "BDT" });
  });
});

describe("constraints", () => {
  it("rejects a duplicate jobs.idempotency_key", async () => {
    const key = "reminder:inv-1:7";
    await db.insert(schema.jobs).values({ type: "reminder.send", idempotencyKey: key });
    await expectDbError(
      db.insert(schema.jobs).values({ type: "reminder.send", idempotencyKey: key }),
      /UNIQUE constraint failed: jobs\.idempotency_key/,
    );
    const inserted = await db
      .insert(schema.jobs)
      .values({ type: "reminder.send", idempotencyKey: key })
      .onConflictDoNothing()
      .returning();
    expect(inserted).toHaveLength(0);
  });

  it("rejects a duplicate public token", async () => {
    const publicToken = token();
    await seedInvoice({ publicToken });
    await expectDbError(
      seedInvoice({ publicToken }),
      /UNIQUE constraint failed: documents\.public_token/,
    );
  });

  it("allows many documents without a public token or number", async () => {
    await seedInvoice();
    await seedInvoice();
  });

  it("rejects a duplicate number for the same kind", async () => {
    await seedInvoice({ number: "INV-0100", status: "sent" });
    await expectDbError(
      seedInvoice({ number: "INV-0100", status: "sent" }),
      /UNIQUE constraint failed/,
    );
  });

  it("rejects a status that does not belong to the kind", async () => {
    await expectDbError(seedInvoice({ status: "accepted" }), /CHECK constraint failed/);
  });

  it("rejects a second primary contact for one client", async () => {
    const client = await seedClient();
    await db
      .insert(schema.clientContacts)
      .values({ clientId: client.id, email: "a@x.test", isPrimary: true });
    await expectDbError(
      db
        .insert(schema.clientContacts)
        .values({ clientId: client.id, email: "b@x.test", isPrimary: true }),
      /UNIQUE constraint failed/,
    );
  });

  it("rejects a duplicate user email", async () => {
    await db.insert(schema.users).values({ email: "member@example.com" });
    await expectDbError(
      db.insert(schema.users).values({ email: "member@example.com" }),
      /UNIQUE constraint failed: users\.email/,
    );
  });

  it("rejects a non-positive payment", async () => {
    const doc = await seedInvoice({ status: "sent" });
    await expectDbError(
      db
        .insert(schema.payments)
        .values({ documentId: doc.id, amount: 0, homeAmount: 0, paidOn: "2026-10-01" }),
      /CHECK constraint failed/,
    );
  });

  it("enforces foreign keys", async () => {
    await expectDbError(
      db.insert(schema.documents).values({ kind: "invoice", clientId: "missing", currency: "USD" }),
      /FOREIGN KEY constraint failed/,
    );
  });
});
