import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ClientDetail, ClientSummary } from "../../src/shared/schemas/client";
import { createDb, schema } from "../../src/worker/db/client";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";

const db = createDb(env.DB);
const OWNER = "owner@clients.test";
const MEMBER = "member@clients.test";

async function resetData() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM payments"),
    env.DB.prepare("DELETE FROM documents"),
    env.DB.prepare("DELETE FROM recurring_schedules"),
    env.DB.prepare("DELETE FROM activity"),
    env.DB.prepare("DELETE FROM client_contacts"),
    env.DB.prepare("DELETE FROM clients"),
    env.DB.prepare("DELETE FROM tax_rates"),
  ]);
}

async function createClient(body: Record<string, unknown>, as = OWNER) {
  const res = await apiFetch("/api/clients", { as, method: "POST", json: body });
  return { res, body: (await res.json()) as ClientDetail };
}

async function insertInvoice(
  clientId: string,
  values: Partial<typeof schema.documents.$inferInsert>,
) {
  await db.insert(schema.documents).values({
    kind: "invoice",
    clientId,
    currency: "USD",
    status: "sent",
    total: 0,
    ...values,
  });
}

beforeAll(async () => {
  installAccessKeys();
  await clearUsers();
  await seedUser(OWNER, "owner");
  await seedUser(MEMBER, "member");
});

beforeEach(resetData);

describe("client CRUD", () => {
  it("creates, edits, and archives a client", async () => {
    const created = await createClient({
      name: "  Northwind  ",
      defaultCurrency: "usd",
      billingAddress: "12 Harbour Road",
      contacts: [
        { name: "Ana", email: "Ana@Northwind.test", isPrimary: true, isBilling: true },
        { email: "ap@northwind.test", isBilling: true },
      ],
    });
    expect(created.res.status).toBe(201);
    const { client, contacts } = created.body;
    expect(client.name).toBe("Northwind");
    expect(client.defaultCurrency).toBe("USD");
    expect(client.reminderMode).toBe("inherit");
    expect(contacts.map((c) => c.email)).toEqual(["ana@northwind.test", "ap@northwind.test"]);
    expect(contacts[0]?.isPrimary).toBe(true);

    const edited = await apiFetch(`/api/clients/${client.id}`, {
      as: MEMBER,
      method: "PATCH",
      json: {
        name: "Northwind Traders",
        paymentTermsDays: 30,
        reminderMode: "off",
        contacts: [{ email: "billing@northwind.test", isPrimary: true }],
      },
    });
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as ClientDetail;
    expect(editedBody.client.name).toBe("Northwind Traders");
    expect(editedBody.client.paymentTermsDays).toBe(30);
    expect(editedBody.client.billingAddress).toBe("12 Harbour Road");
    expect(editedBody.contacts.map((c) => c.email)).toEqual(["billing@northwind.test"]);

    const archived = await apiFetch(`/api/clients/${client.id}/archive`, {
      as: MEMBER,
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as ClientDetail).client.archivedAt).toBeTypeOf("number");

    const active = await apiFetch("/api/clients", { as: MEMBER });
    expect(((await active.json()) as { items: ClientSummary[] }).items).toHaveLength(0);
    const archivedList = await apiFetch("/api/clients?archived=archived", { as: MEMBER });
    const items = ((await archivedList.json()) as { items: ClientSummary[] }).items;
    expect(items.map((i) => i.name)).toEqual(["Northwind Traders"]);
    expect(items[0]?.primaryEmail).toBe("billing@northwind.test");

    const restored = await apiFetch(`/api/clients/${client.id}/restore`, {
      as: OWNER,
      method: "POST",
    });
    expect(((await restored.json()) as ClientDetail).client.archivedAt).toBeNull();
  });

  it("lets a Member read clients", async () => {
    const { body } = await createClient({ name: "Contoso", defaultCurrency: "BDT" });
    const res = await apiFetch(`/api/clients/${body.client.id}`, { as: MEMBER });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ClientDetail).client.name).toBe("Contoso");
  });

  it("searches by name and contact email", async () => {
    await createClient({ name: "Alpha Studio", defaultCurrency: "BDT" });
    await createClient({
      name: "Beta",
      defaultCurrency: "BDT",
      contacts: [{ email: "hello@alpha-mail.test" }],
    });
    await createClient({ name: "100% Coffee", defaultCurrency: "BDT" });

    const search = async (q: string) => {
      const res = await apiFetch(`/api/clients?q=${encodeURIComponent(q)}`, { as: MEMBER });
      return ((await res.json()) as { items: ClientSummary[] }).items.map((i) => i.name);
    };
    expect(await search("alpha")).toEqual(["Alpha Studio", "Beta"]);
    expect(await search("%")).toEqual(["100% Coffee"]);
  });

  it("rejects invalid input with field issues", async () => {
    const { res } = await createClient({
      name: "",
      defaultCurrency: "XYZ",
      contacts: [
        { email: "not-an-email", isPrimary: true },
        { email: "b@x.test", isPrimary: true },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await apiFetch("/api/clients", {
      as: OWNER,
      method: "POST",
      json: { name: "", defaultCurrency: "XYZ" },
    }).then((r) => r.json())) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path).sort()).toEqual(["defaultCurrency", "name"]);
  });

  it("rejects an archived default tax rate", async () => {
    const [rate] = await db
      .insert(schema.taxRates)
      .values({ name: "Old VAT", rate: "10", archivedAt: Date.now() })
      .returning();
    const { res } = await createClient({
      name: "Fabrikam",
      defaultCurrency: "BDT",
      defaultTaxRateId: rate?.id,
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown client", async () => {
    const res = await apiFetch("/api/clients/nope", { as: MEMBER });
    expect(res.status).toBe(404);
  });
});

describe("auto-send is Owner-only", () => {
  it("returns 403 when a Member sets reminder mode to auto-send", async () => {
    const { res } = await createClient(
      { name: "Northwind", defaultCurrency: "USD", reminderMode: "auto_send" },
      MEMBER,
    );
    expect(res.status).toBe(403);

    const { body } = await createClient({ name: "Northwind", defaultCurrency: "USD" });
    const patch = await apiFetch(`/api/clients/${body.client.id}`, {
      as: MEMBER,
      method: "PATCH",
      json: { reminderMode: "auto_send" },
    });
    expect(patch.status).toBe(403);
  });

  it("returns 403 when a Member sets recurring send mode to auto-send", async () => {
    const { body } = await createClient({ name: "Northwind", defaultCurrency: "USD" });
    const patch = await apiFetch(`/api/clients/${body.client.id}`, {
      as: MEMBER,
      method: "PATCH",
      json: { recurringSendMode: "auto_send" },
    });
    expect(patch.status).toBe(403);
  });

  it("lets a Member save other fields of an auto-send client unchanged", async () => {
    const { body } = await createClient({
      name: "Northwind",
      defaultCurrency: "USD",
      reminderMode: "auto_send",
      recurringSendMode: "auto_send",
    });
    expect(body.client.reminderMode).toBe("auto_send");

    const keep = await apiFetch(`/api/clients/${body.client.id}`, {
      as: MEMBER,
      method: "PATCH",
      json: { name: "Northwind Ltd", reminderMode: "auto_send", recurringSendMode: "auto_send" },
    });
    expect(keep.status).toBe(200);

    const turnOff = await apiFetch(`/api/clients/${body.client.id}`, {
      as: MEMBER,
      method: "PATCH",
      json: { reminderMode: "off" },
    });
    expect(turnOff.status).toBe(403);
  });
});

describe("archiving", () => {
  it("pauses the client's active recurring schedules", async () => {
    const { body } = await createClient({ name: "Northwind", defaultCurrency: "USD" });
    const clientId = body.client.id;
    const base = {
      clientId,
      currency: "USD",
      frequency: "monthly" as const,
      startDate: "2026-10-01",
      anchorDay: 1,
      nextIssueDate: "2026-11-01",
    };
    await db.insert(schema.recurringSchedules).values([
      { ...base, id: "active-schedule" },
      { ...base, id: "ended-schedule", status: "ended" },
    ]);

    const res = await apiFetch(`/api/clients/${clientId}/archive`, { as: OWNER, method: "POST" });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as ClientDetail;
    expect(detail.schedules.map((s) => [s.id, s.status]).sort()).toEqual([
      ["active-schedule", "paused"],
      ["ended-schedule", "ended"],
    ]);
    const [paused] = await db
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, "active-schedule"));
    expect(paused?.pausedReason).toBe("client_archived");
  });
});

describe("client detail", () => {
  it("returns empty documents, payments, and balances for a new client", async () => {
    const { body } = await createClient({ name: "Empty", defaultCurrency: "BDT" });
    const res = await apiFetch(`/api/clients/${body.client.id}`, { as: MEMBER });
    const detail = (await res.json()) as ClientDetail;
    expect(detail.documents).toEqual([]);
    expect(detail.payments).toEqual([]);
    expect(detail.outstanding).toEqual([]);
  });

  it("groups the outstanding balance of open invoices by currency", async () => {
    const { body } = await createClient({ name: "Northwind", defaultCurrency: "USD" });
    const other = await createClient({ name: "Other", defaultCurrency: "USD" });
    const clientId = body.client.id;
    await insertInvoice(clientId, { id: "usd-1", number: "INV-0001", total: 200_000 });
    await insertInvoice(clientId, {
      id: "usd-2",
      number: "INV-0002",
      status: "partially_paid",
      total: 100_000,
      amountPaid: 40_000,
    });
    await insertInvoice(clientId, {
      id: "eur-1",
      number: "INV-0003",
      currency: "EUR",
      total: 5_000,
    });
    await insertInvoice(clientId, { id: "paid", number: "INV-0004", status: "paid", total: 999 });
    await insertInvoice(clientId, { id: "void", number: "INV-0005", status: "void", total: 999 });
    await insertInvoice(clientId, { id: "draft", status: "draft", total: 999 });
    await insertInvoice(other.body.client.id, { id: "other", number: "INV-0006", total: 777 });
    await db.insert(schema.payments).values({
      documentId: "usd-2",
      amount: 40_000,
      homeAmount: 4_800_000,
      paidOn: "2026-10-20",
    });

    const res = await apiFetch(`/api/clients/${clientId}`, { as: MEMBER });
    const detail = (await res.json()) as ClientDetail;
    expect(detail.outstanding).toEqual([
      { currency: "EUR", amount: 5_000, count: 1 },
      { currency: "USD", amount: 260_000, count: 2 },
    ]);
    expect(detail.documents).toHaveLength(6);
    expect(detail.payments).toEqual([
      expect.objectContaining({ documentNumber: "INV-0002", currency: "USD", amount: 40_000 }),
    ]);

    const list = await apiFetch("/api/clients", { as: MEMBER });
    const items = ((await list.json()) as { items: ClientSummary[] }).items;
    expect(items.find((i) => i.id === clientId)?.outstanding).toHaveLength(2);
  });
});
