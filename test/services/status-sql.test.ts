import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { isOverdue } from "../../src/shared/schemas/document";
import { schema } from "../../src/worker/db/client";
import { getClientDetail } from "../../src/worker/routes/clients";
import { listDocuments } from "../../src/worker/services/documents";
import { updateDerivedStatuses } from "../../src/worker/services/scheduler";
import { overdueCondition, overdueSql } from "../../src/worker/services/status-sql";
import { db, NOW, resetDocuments, TODAY } from "../helpers/documents";

/** One fixture per rule edge. TODAY is 2026-10-23. */
const FIXTURES = {
  pastDue: { kind: "invoice", status: "sent", dueDate: "2026-10-22" },
  partialPastDue: {
    kind: "invoice",
    status: "partially_paid",
    dueDate: "2026-10-01",
    amountPaid: 4000,
  },
  dueToday: { kind: "invoice", status: "sent", dueDate: TODAY },
  noDueDate: { kind: "invoice", status: "sent", dueDate: null },
  zeroBalance: { kind: "invoice", status: "sent", dueDate: "2026-10-01", amountPaid: 10000 },
  paid: { kind: "invoice", status: "paid", dueDate: "2026-10-01", amountPaid: 10000 },
  void: { kind: "invoice", status: "void", dueDate: "2026-10-01" },
  finalized: { kind: "invoice", status: "finalized", dueDate: "2026-10-01" },
  draft: { kind: "invoice", status: "draft", dueDate: "2026-10-01" },
  staleCachedFlag: { kind: "invoice", status: "sent", dueDate: "2026-11-30", isOverdue: true },
  sentQuote: { kind: "quote", status: "sent", dueDate: "2026-10-01" },
} as const;

async function seed() {
  const [client] = await db.insert(schema.clients).values({ name: "Northwind" }).returning();
  if (!client) throw new Error("client insert failed");
  const names = new Map<string, string>();
  for (const [name, values] of Object.entries(FIXTURES)) {
    const [doc] = await db
      .insert(schema.documents)
      .values({ clientId: client.id, currency: "USD", total: 10000, ...values })
      .returning();
    if (!doc) throw new Error(`${name} insert failed`);
    names.set(doc.id, name);
  }
  return { clientId: client.id, names };
}

beforeEach(resetDocuments);

describe("overdue rule", () => {
  it("gives the same answer in TypeScript and in every SQL form", async () => {
    const { clientId, names } = await seed();
    const rows = await db.select().from(schema.documents);
    const expected = rows
      .filter((row) => isOverdue(row, TODAY))
      .map((row) => names.get(row.id))
      .sort();
    expect(expected).toEqual(["partialPastDue", "pastDue"]);

    const nameOf = (ids: string[]) => ids.map((id) => names.get(id)).sort();

    const raw = await env.DB.prepare(`SELECT id FROM documents WHERE ${overdueCondition("?1")}`)
      .bind(TODAY)
      .all<{ id: string }>();
    expect(nameOf(raw.results.map((r) => r.id))).toEqual(expected);

    // The dashboard and the reports use this aliased form.
    const aliased = await db.all<{ id: string }>(
      sql`SELECT d.id AS id FROM documents d WHERE ${overdueSql(TODAY, "d.")}`,
    );
    expect(nameOf(aliased.map((r) => r.id))).toEqual(expected);

    const list = await listDocuments(db, { filter: "overdue" }, { now: NOW });
    expect(nameOf(list.items.map((item) => item.id))).toEqual(expected);
    for (const item of list.items) expect(item.displayStatus).toBe("overdue");

    await updateDerivedStatuses(db, TODAY, NOW);
    const flagged = await db.select().from(schema.documents);
    expect(nameOf(flagged.filter((row) => row.isOverdue).map((row) => row.id))).toEqual(expected);

    const detail = await getClientDetail(db, clientId, NOW);
    const shown = detail.documents.filter((doc) => doc.displayStatus === "overdue");
    expect(nameOf(shown.map((doc) => doc.id))).toEqual(expected);
  });
});
