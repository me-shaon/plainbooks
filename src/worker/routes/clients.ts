import { and, asc, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { ReminderModeSetting, SendModeSetting } from "../../shared/domain";
import {
  type Client,
  type ClientCreateData,
  type ClientDetail,
  type ClientSummary,
  type ContactInput,
  clientCreateInput,
  clientListQuery,
  clientUpdateInput,
  type OutstandingBalance,
} from "../../shared/schemas/client";
import { type Db, schema } from "../db/client";
import type { AppEnv, AuthUser } from "../env";
import { AppError, parseJson } from "../errors";

const { clients, clientContacts, documents, payments, recurringSchedules, taxRates, templates } =
  schema;

/** Invoice statuses with an open balance. Drafts, unsent, void, and paid invoices are not open. */
export const OPEN_INVOICE_STATUSES = ["sent", "partially_paid"] as const;

const clientColumns = {
  id: clients.id,
  name: clients.name,
  billingAddress: clients.billingAddress,
  taxId: clients.taxId,
  defaultCurrency: clients.defaultCurrency,
  defaultTaxRateId: clients.defaultTaxRateId,
  paymentTermsDays: clients.paymentTermsDays,
  templateId: clients.templateId,
  reminderMode: clients.reminderMode,
  recurringSendMode: clients.recurringSendMode,
  notes: clients.notes,
  archivedAt: clients.archivedAt,
  createdAt: clients.createdAt,
  updatedAt: clients.updatedAt,
};

const contactColumns = {
  id: clientContacts.id,
  name: clientContacts.name,
  email: clientContacts.email,
  isPrimary: clientContacts.isPrimary,
  isBilling: clientContacts.isBilling,
};

interface AutoSendSettings {
  reminderMode: ReminderModeSetting;
  recurringSendMode: SendModeSetting;
}

/**
 * Only an Owner can turn auto-send on, or change a setting that is already auto-send (R55).
 * Members can change the other values.
 */
export function assertAutoSendAllowed(
  user: AuthUser,
  before: AutoSendSettings,
  after: Partial<AutoSendSettings>,
): void {
  if (user.role === "owner") return;
  const touches = (key: keyof AutoSendSettings) => {
    const next = after[key];
    if (next === undefined || next === before[key]) return false;
    return next === "auto_send" || before[key] === "auto_send";
  };
  if (touches("reminderMode") || touches("recurringSendMode")) {
    throw new AppError(403, "owner_required", "Only an Owner can change auto-send settings");
  }
}

/** Checks that the referenced tax rate and template exist. */
async function assertReferences(
  db: Db,
  refs: { defaultTaxRateId?: string | null; templateId?: string | null },
  current?: { defaultTaxRateId: string | null },
): Promise<void> {
  const taxRateId = refs.defaultTaxRateId;
  if (taxRateId && taxRateId !== current?.defaultTaxRateId) {
    const [rate] = await db
      .select({ archivedAt: taxRates.archivedAt })
      .from(taxRates)
      .where(eq(taxRates.id, taxRateId));
    if (!rate || rate.archivedAt !== null) {
      throw new AppError(400, "invalid_tax_rate", "Choose an active tax rate");
    }
  }
  if (refs.templateId) {
    const [template] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, refs.templateId));
    if (!template) throw new AppError(400, "invalid_template", "Choose an existing template");
  }
}

function contactRows(clientId: string, contacts: ContactInput[]) {
  return contacts.map((contact) => ({
    clientId,
    name: contact.name ?? null,
    email: contact.email,
    isPrimary: contact.isPrimary ?? false,
    isBilling: contact.isBilling ?? false,
  }));
}

async function findClient(db: Db, id: string): Promise<Client> {
  const [client] = await db.select(clientColumns).from(clients).where(eq(clients.id, id));
  if (!client) throw new AppError(404, "client_not_found", "This client does not exist");
  return client;
}

/** Open invoice balances, grouped by client and currency. */
async function outstandingByClient(
  db: Db,
  clientIds?: string[],
): Promise<Map<string, OutstandingBalance[]>> {
  const conditions: SQL[] = [
    eq(documents.kind, "invoice"),
    inArray(documents.status, OPEN_INVOICE_STATUSES),
  ];
  if (clientIds) conditions.push(inArray(documents.clientId, clientIds));
  const rows = await db
    .select({
      clientId: documents.clientId,
      currency: documents.currency,
      amount: sql<number>`sum(${documents.total} - ${documents.amountPaid})`,
      count: sql<number>`count(*)`,
    })
    .from(documents)
    .where(and(...conditions))
    .groupBy(documents.clientId, documents.currency)
    .orderBy(documents.currency);
  const result = new Map<string, OutstandingBalance[]>();
  for (const row of rows) {
    const list = result.get(row.clientId) ?? [];
    list.push({ currency: row.currency, amount: Number(row.amount), count: Number(row.count) });
    result.set(row.clientId, list);
  }
  return result;
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function getClientDetail(db: Db, id: string): Promise<ClientDetail> {
  const client = await findClient(db, id);
  const [contacts, docs, paymentRows, schedules, outstanding] = await Promise.all([
    db
      .select(contactColumns)
      .from(clientContacts)
      .where(eq(clientContacts.clientId, id))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt)),
    db
      .select({
        id: documents.id,
        kind: documents.kind,
        status: documents.status,
        number: documents.number,
        currency: documents.currency,
        issueDate: documents.issueDate,
        dueDate: documents.dueDate,
        total: documents.total,
        amountPaid: documents.amountPaid,
        isOverdue: documents.isOverdue,
      })
      .from(documents)
      .where(eq(documents.clientId, id))
      .orderBy(desc(documents.createdAt))
      .limit(100),
    db
      .select({
        id: payments.id,
        documentId: payments.documentId,
        documentNumber: documents.number,
        kind: payments.kind,
        currency: documents.currency,
        amount: payments.amount,
        paidOn: payments.paidOn,
      })
      .from(payments)
      .innerJoin(documents, eq(payments.documentId, documents.id))
      .where(eq(documents.clientId, id))
      .orderBy(desc(payments.paidOn), desc(payments.createdAt))
      .limit(100),
    db
      .select({
        id: recurringSchedules.id,
        name: recurringSchedules.name,
        frequency: recurringSchedules.frequency,
        status: recurringSchedules.status,
        nextIssueDate: recurringSchedules.nextIssueDate,
      })
      .from(recurringSchedules)
      .where(eq(recurringSchedules.clientId, id))
      .orderBy(asc(recurringSchedules.createdAt)),
    outstandingByClient(db, [id]),
  ]);
  return {
    client,
    contacts,
    documents: docs,
    payments: paymentRows,
    schedules,
    outstanding: outstanding.get(id) ?? [],
  };
}

async function createClient(db: Db, user: AuthUser, data: ClientCreateData): Promise<string> {
  assertAutoSendAllowed(user, { reminderMode: "inherit", recurringSendMode: "inherit" }, data);
  await assertReferences(db, data);
  const id = crypto.randomUUID();
  const { contacts, ...fields } = data;
  const insertClient = db.insert(clients).values({ id, ...fields });
  const insertActivity = db
    .insert(schema.activity)
    .values({ clientId: id, type: "client_created", actorUserId: user.id });
  if (contacts.length > 0) {
    await db.batch([
      insertClient,
      db.insert(clientContacts).values(contactRows(id, contacts)),
      insertActivity,
    ]);
  } else {
    await db.batch([insertClient, insertActivity]);
  }
  return id;
}

/**
 * Archives a client and pauses its active recurring schedules in one batch (R52).
 * Documents stay. Archived clients drop out of pickers.
 */
export async function archiveClient(db: Db, user: AuthUser, id: string): Promise<void> {
  const client = await findClient(db, id);
  if (client.archivedAt !== null) return;
  const now = Date.now();
  await db.batch([
    db
      .update(clients)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(clients.id, id), isNull(clients.archivedAt))),
    db
      .update(recurringSchedules)
      .set({ status: "paused", pausedReason: "client_archived", updatedAt: now })
      .where(and(eq(recurringSchedules.clientId, id), eq(recurringSchedules.status, "active"))),
    db
      .insert(schema.activity)
      .values({ clientId: id, type: "client_archived", actorUserId: user.id }),
  ]);
}

/**
 * Client routes, mounted at /api/clients. Members can read and edit clients, except the
 * auto-send settings.
 */
export const clientRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.var.db;
    const query = clientListQuery.parse(c.req.query());
    const conditions: SQL[] = [];
    if (query.archived === "active") conditions.push(isNull(clients.archivedAt));
    if (query.archived === "archived") conditions.push(isNotNull(clients.archivedAt));
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(
        sql`(${clients.name} LIKE ${pattern} ESCAPE '\\' OR EXISTS (SELECT 1 FROM ${clientContacts} WHERE ${clientContacts.clientId} = ${clients.id} AND ${clientContacts.email} LIKE ${pattern} ESCAPE '\\'))`,
      );
    }
    const rows = await db
      .select({
        id: clients.id,
        name: clients.name,
        defaultCurrency: clients.defaultCurrency,
        archivedAt: clients.archivedAt,
        // Raw names: Drizzle drops table prefixes inside select fields, which breaks
        // the correlated subquery.
        primaryEmail: sql<
          string | null
        >`(SELECT cc.email FROM client_contacts cc WHERE cc.client_id = clients.id ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1)`,
      })
      .from(clients)
      .where(and(...conditions))
      .orderBy(sql`${clients.name} COLLATE NOCASE`)
      .limit(500);
    const outstanding = await outstandingByClient(db);
    const items: ClientSummary[] = rows.map((row) => ({
      ...row,
      outstanding: outstanding.get(row.id) ?? [],
    }));
    return c.json({ items });
  })
  .post("/", async (c) => {
    const data = await parseJson(c, clientCreateInput);
    const id = await createClient(c.var.db, c.var.user, data);
    return c.json(await getClientDetail(c.var.db, id), 201);
  })
  .get("/:id", async (c) => c.json(await getClientDetail(c.var.db, c.req.param("id"))))
  .patch("/:id", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    const data = await parseJson(c, clientUpdateInput);
    const current = await findClient(db, id);
    assertAutoSendAllowed(c.var.user, current, data);
    await assertReferences(db, data, current);
    const { contacts, ...fields } = data;
    const update = db
      .update(clients)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(clients.id, id));
    if (contacts) {
      const deleteContacts = db.delete(clientContacts).where(eq(clientContacts.clientId, id));
      if (contacts.length > 0) {
        await db.batch([
          update,
          deleteContacts,
          db.insert(clientContacts).values(contactRows(id, contacts)),
        ]);
      } else {
        await db.batch([update, deleteContacts]);
      }
    } else {
      await update;
    }
    return c.json(await getClientDetail(db, id));
  })
  .post("/:id/archive", async (c) => {
    await archiveClient(c.var.db, c.var.user, c.req.param("id"));
    return c.json(await getClientDetail(c.var.db, c.req.param("id")));
  })
  .post("/:id/restore", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    await findClient(db, id);
    // Restoring does not resume paused schedules. The user resumes each one on purpose.
    await db
      .update(clients)
      .set({ archivedAt: null, updatedAt: Date.now() })
      .where(eq(clients.id, id));
    return c.json(await getClientDetail(db, id));
  });
