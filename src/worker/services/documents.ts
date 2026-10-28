// Quotes and invoices: drafts, numbering at finalize, revisions, void, duplicate, convert,
// and quote decisions. Every state change writes one activity row in the same D1 batch.
// D1 has no interactive transactions, so each change is one batch of conditional
// statements, and the code checks the affected rows of the guarded UPDATE.
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { DEFAULT_TEMPLATE_CONFIG, type ReminderModeSetting } from "../../shared/domain";
import {
  calculateTotals,
  convertTotals,
  type DiscountInput,
  normalizeRate,
  rateToScaled,
} from "../../shared/money";
import {
  type DiscountValue,
  type DocumentCreateData,
  type DocumentDetail,
  type DocumentLineView,
  type DocumentListQuery,
  type DocumentSnapshot,
  type DocumentSummary,
  type DocumentUpdateData,
  displayStatus,
  documentListQuery,
  isOverdue,
  type LineInputData,
  MAX_DECISION_COMMENT,
  OPEN_STATUSES,
  type RevisionSummary,
  type SnapshotCustomField,
} from "../../shared/schemas/document";
import { normalizeTemplateConfig } from "../../shared/schemas/template";
import { addDays, todayIn } from "../../shared/time";
import { type Db, schema } from "../db/client";
import type { Document, DocumentRevision, Workspace } from "../db/schema";
import type { AuthUser } from "../env";
import { AppError } from "../errors";
import { type ActivityInput, guardedActivity } from "./activity";
import { type Fetcher, type FxRate, getRate, manualRate } from "./fx";
import { type EnqueueInput, guardedEnqueueStatement, needsReviewSql, reviewJobIdSql } from "./jobs";
import { counterIncrement, numberExpression, UNNUMBERED_DRAFT } from "./numbering";
import { brandKitOf, loadWorkspace } from "./settings";
import { overdueSql } from "./status-sql";

// The workspace loader lives in settings.ts. Callers import it from here too.
export { forgetWorkspace, loadWorkspace } from "./settings";

const {
  clients,
  clientContacts,
  documents,
  documentLines,
  documentRevisions,
  payments,
  taxRates,
  templates,
  customFieldDefs,
  customFieldValues,
} = schema;

/** Who acts and when. `actor` is null for the scheduler. */
export interface ActionContext {
  actor?: AuthUser | null;
  now: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Turns a Drizzle query into a raw D1 statement, so it can join a raw batch. */
function toStatement(d1: D1Database, query: { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql: text, params } = query.toSQL();
  return d1.prepare(text).bind(...params);
}

function changes(result: D1Result | undefined): number {
  return result?.meta.changes ?? 0;
}

/** 128-bit random token, base64url without padding. */
export function newPublicToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Today in the workspace timezone. */
export function workspaceToday(ws: Pick<Workspace, "timezone">, now: number): string {
  return todayIn(ws.timezone, now);
}

export async function loadDocument(db: Db, id: string): Promise<Document> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) throw new AppError(404, "document_not_found", "This document does not exist");
  return doc;
}

async function loadLines(db: Db, documentId: string): Promise<DocumentLineView[]> {
  return db
    .select({
      id: documentLines.id,
      position: documentLines.position,
      description: documentLines.description,
      quantity: documentLines.quantity,
      unitPrice: documentLines.unitPrice,
      taxRateId: documentLines.taxRateId,
    })
    .from(documentLines)
    .where(eq(documentLines.documentId, documentId))
    .orderBy(asc(documentLines.position));
}

/** True once a number is allocated. Then the content is frozen until a revise. */
function isLocked(doc: Pick<Document, "status" | "number">): boolean {
  return doc.status !== "draft" || doc.number !== null;
}

function assertEditableDraft(doc: Document): void {
  if (isLocked(doc)) {
    throw new AppError(409, "document_locked", "Only an unsent draft can be edited");
  }
}

/** R55: only an Owner can turn on auto-send reminders, or change one that is on. */
export function assertReminderModeAllowed(
  actor: AuthUser | null | undefined,
  before: ReminderModeSetting,
  after: ReminderModeSetting | undefined,
): void {
  if (!actor || actor.role === "owner") return;
  if (after === undefined || after === before) return;
  if (after === "auto_send" || before === "auto_send") {
    throw new AppError(403, "owner_required", "Only an Owner can change auto-send settings");
  }
}

function discountColumns(discount: DiscountValue) {
  return {
    discountType: discount.type,
    discountPercent: discount.type === "percent" ? discount.percent : null,
    discountAmount: discount.type === "fixed" ? discount.amount : null,
  };
}

function discountFromRow(
  doc: Pick<Document, "discountType" | "discountPercent" | "discountAmount">,
): DiscountValue {
  if (doc.discountType === "percent")
    return { type: "percent", percent: doc.discountPercent ?? "0" };
  if (doc.discountType === "fixed") return { type: "fixed", amount: doc.discountAmount ?? 0 };
  return { type: "none" };
}

function discountForEngine(discount: DiscountValue): DiscountInput | null {
  if (discount.type === "none") return null;
  return discount;
}

interface TaxRateInfo {
  id: string;
  name: string;
  rate: string;
  note: string | null;
  archivedAt: number | null;
}

async function loadTaxRates(db: Db, ids: string[]): Promise<Map<string, TaxRateInfo>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: taxRates.id,
      name: taxRates.name,
      rate: taxRates.rate,
      note: taxRates.note,
      archivedAt: taxRates.archivedAt,
    })
    .from(taxRates)
    .where(inArray(taxRates.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Checks the tax rates on new lines. Archived rates are allowed only when the document
 * already uses them.
 */
async function validateLineTaxes(
  db: Db,
  lines: LineInputData[],
  existingIds: Set<string> = new Set(),
): Promise<Map<string, TaxRateInfo>> {
  const ids = lines.map((l) => l.taxRateId).filter((id): id is string => Boolean(id));
  const rates = await loadTaxRates(db, ids);
  for (const id of ids) {
    const rate = rates.get(id);
    if (!rate || (rate.archivedAt !== null && !existingIds.has(id))) {
      throw new AppError(400, "invalid_tax_rate", "Choose an active tax rate for each line");
    }
  }
  return rates;
}

function computeTotals(
  currency: string,
  lines: Pick<LineInputData, "quantity" | "unitPrice" | "taxRateId">[],
  discount: DiscountValue,
  rates: Map<string, TaxRateInfo>,
) {
  return calculateTotals({
    currency,
    discount: discountForEngine(discount),
    lines: lines.map((line) => {
      const rate = line.taxRateId ? rates.get(line.taxRateId) : undefined;
      return {
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        tax: rate ? { id: rate.id, name: rate.name, rate: rate.rate } : null,
      };
    }),
  });
}

async function assertClient(db: Db, clientId: string, allowArchived = false) {
  const [client] = await db
    .select({
      id: clients.id,
      defaultCurrency: clients.defaultCurrency,
      archivedAt: clients.archivedAt,
    })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client || (!allowArchived && client.archivedAt !== null)) {
    throw new AppError(400, "invalid_client", "Choose an active client");
  }
  return client;
}

async function assertTemplate(db: Db, templateId: string | null | undefined): Promise<void> {
  if (!templateId) return;
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(eq(templates.id, templateId));
  if (!row) throw new AppError(400, "invalid_template", "Choose an existing template");
}

async function assertCustomFields(
  db: Db,
  values: { fieldId: string; value: string }[] | undefined,
): Promise<void> {
  if (!values || values.length === 0) return;
  const ids = [...new Set(values.map((v) => v.fieldId))];
  if (ids.length !== values.length) {
    throw new AppError(400, "invalid_custom_field", "Each custom field can appear once");
  }
  const defs = await db
    .select({ id: customFieldDefs.id, scope: customFieldDefs.scope })
    .from(customFieldDefs)
    .where(inArray(customFieldDefs.id, ids));
  if (defs.length !== ids.length || defs.some((d) => d.scope !== "document")) {
    throw new AppError(400, "invalid_custom_field", "Choose document custom fields only");
  }
}

// ---------------------------------------------------------------------------
// Raw statements shared by several actions
// ---------------------------------------------------------------------------

/** Inserts lines from one JSON parameter (D1 allows 100 bound parameters per statement). */
function insertLines(
  d1: D1Database,
  documentId: string,
  lines: Pick<LineInputData, "description" | "quantity" | "unitPrice" | "taxRateId">[],
  guard = "1",
  guardParams: unknown[] = [],
): D1PreparedStatement {
  const payload = lines.map((line, position) => ({
    id: crypto.randomUUID(),
    position,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRateId: line.taxRateId ?? null,
  }));
  return d1
    .prepare(
      `INSERT INTO document_lines (id, document_id, position, description, quantity, unit_price, tax_rate_id)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.position'),
              json_extract(value, '$.description'), json_extract(value, '$.quantity'),
              json_extract(value, '$.unitPrice'), json_extract(value, '$.taxRateId')
       FROM json_each(?) WHERE ${guard}`,
    )
    .bind(documentId, JSON.stringify(payload), ...guardParams);
}

function deleteLines(d1: D1Database, documentId: string, guard = "1", guardParams: unknown[] = []) {
  return d1
    .prepare(`DELETE FROM document_lines WHERE document_id = ? AND ${guard}`)
    .bind(documentId, ...guardParams);
}

/** Replaces the document-scope custom field values. Empty values are removed. */
function replaceCustomFields(
  d1: D1Database,
  documentId: string,
  values: { fieldId: string; value: string }[],
  guard = "1",
  guardParams: unknown[] = [],
): D1PreparedStatement[] {
  const kept = values.filter((v) => v.value !== "");
  return [
    d1
      .prepare(
        `DELETE FROM custom_field_values WHERE entity_type = 'document' AND entity_id = ? AND ${guard}`,
      )
      .bind(documentId, ...guardParams),
    d1
      .prepare(
        `INSERT INTO custom_field_values (id, field_id, entity_type, entity_id, value, updated_at)
         SELECT lower(hex(randomblob(16))), json_extract(value, '$.fieldId'), 'document', ?,
                json_extract(value, '$.value'), ?
         FROM json_each(?) WHERE ${guard}`,
      )
      .bind(documentId, Date.now(), JSON.stringify(kept), ...guardParams),
  ];
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

function fxColumns(fx: { rate: string; date: string } | null) {
  if (!fx) {
    return {
      fxRate: null,
      fxRateScaled: null,
      fxRateDate: null,
      fxProvider: null,
      fxOverridden: false,
    };
  }
  const manual = manualRate(fx.rate, fx.date);
  return {
    fxRate: manual.rate,
    fxRateScaled: manual.rateScaled,
    fxRateDate: manual.rateDate,
    fxProvider: "manual" as const,
    fxOverridden: true,
  };
}

/** The home currency converts at exactly 1, so a manual rate for it must be 1. */
async function assertManualRate(
  db: Db,
  currency: string,
  fxRate: { rate: string } | null | undefined,
): Promise<void> {
  if (!fxRate || normalizeRate(fxRate.rate) === "1") return;
  const ws = await loadWorkspace(db);
  if (currency === ws.homeCurrency) {
    throw new AppError(
      422,
      "invalid_fx_rate",
      `${currency} is the home currency, so its exchange rate is always 1`,
    );
  }
}

/** Creates a draft. It has no number until finalize. */
export async function createDraft(
  db: Db,
  data: DocumentCreateData,
  ctx: ActionContext,
  /**
   * Set by the recurring scheduler (U15). The pair is unique, so a period runs once.
   * `allowTaxRateIds` are the schedule's own rates, which stay valid after they are archived.
   */
  origin?: { recurringScheduleId: string; recurringPeriodId: string; allowTaxRateIds?: string[] },
): Promise<string> {
  assertReminderModeAllowed(ctx.actor, "inherit", data.reminderMode);
  const client = await assertClient(db, data.clientId);
  await assertTemplate(db, data.templateId);
  await assertCustomFields(db, data.customFields);
  const rates = await validateLineTaxes(db, data.lines, new Set(origin?.allowTaxRateIds));
  const currency = data.currency ?? client.defaultCurrency;
  await assertManualRate(db, currency, data.fxRate);
  const totals = computeTotals(currency, data.lines, data.discount, rates);

  const d1 = db.$client;
  const id = crypto.randomUUID();
  const insert = db.insert(documents).values({
    id,
    kind: data.kind,
    status: "draft",
    clientId: data.clientId,
    currency,
    issueDate: data.issueDate,
    dueDate: data.kind === "invoice" ? data.dueDate : null,
    expiryDate: data.kind === "quote" ? data.expiryDate : null,
    paymentTermsDays: data.paymentTermsDays,
    ...discountColumns(data.discount),
    notes: data.notes,
    footerText: data.footerText,
    templateId: data.templateId,
    reminderMode: data.reminderMode,
    ...fxColumns(data.fxRate),
    subtotal: totals.subtotal,
    discountTotal: totals.discount,
    taxTotal: totals.taxTotal,
    total: totals.total,
    recurringScheduleId: origin?.recurringScheduleId ?? null,
    recurringPeriodId: origin?.recurringPeriodId ?? null,
    createdBy: ctx.actor?.id ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  await d1.batch([
    toStatement(d1, insert),
    insertLines(d1, id, data.lines),
    ...replaceCustomFields(d1, id, data.customFields),
    guardedActivity(
      d1,
      activityOf(id, data.clientId, "created", ctx, {
        kind: data.kind,
        recurringScheduleId: origin?.recurringScheduleId,
        recurringPeriodId: origin?.recurringPeriodId,
      }),
      "1",
      [],
    ),
  ]);
  return id;
}

function activityOf(
  documentId: string,
  clientId: string,
  type: ActivityInput["type"],
  ctx: ActionContext,
  data?: Record<string, unknown>,
): ActivityInput {
  return { documentId, clientId, type, actorUserId: ctx.actor?.id ?? null, data, now: ctx.now };
}

/** Edits an unsent draft. `lines` and `customFields`, when present, replace the lists. */
export async function updateDraft(
  db: Db,
  id: string,
  data: DocumentUpdateData,
  ctx: ActionContext,
): Promise<void> {
  const doc = await loadDocument(db, id);
  assertEditableDraft(doc);
  assertReminderModeAllowed(ctx.actor, doc.reminderMode, data.reminderMode);
  if (data.clientId && data.clientId !== doc.clientId) await assertClient(db, data.clientId);
  if (data.templateId !== undefined) await assertTemplate(db, data.templateId);
  await assertCustomFields(db, data.customFields);

  const existing = await loadLines(db, id);
  const lines = data.lines ?? existing;
  const existingTaxIds = new Set(existing.map((l) => l.taxRateId).filter((v): v is string => !!v));
  const rates = await validateLineTaxes(db, lines, existingTaxIds);
  const currency = data.currency ?? doc.currency;
  await assertManualRate(db, currency, data.fxRate);
  // A manual rate belongs to one currency pair. A new currency without a new rate clears it.
  const fx =
    data.fxRate !== undefined
      ? fxColumns(data.fxRate)
      : currency !== doc.currency
        ? fxColumns(null)
        : {};
  const discount = data.discount ?? discountFromRow(doc);
  const totals = computeTotals(currency, lines, discount, rates);

  const d1 = db.$client;
  const guard = `EXISTS (SELECT 1 FROM documents WHERE id = ? AND ${UNNUMBERED_DRAFT})`;
  const update = db
    .update(documents)
    .set({
      clientId: data.clientId,
      currency,
      issueDate: data.issueDate,
      dueDate: doc.kind === "invoice" ? data.dueDate : undefined,
      expiryDate: doc.kind === "quote" ? data.expiryDate : undefined,
      paymentTermsDays: data.paymentTermsDays,
      ...(data.discount ? discountColumns(data.discount) : {}),
      notes: data.notes,
      footerText: data.footerText,
      templateId: data.templateId,
      reminderMode: data.reminderMode,
      ...fx,
      subtotal: totals.subtotal,
      discountTotal: totals.discount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      updatedAt: ctx.now,
    })
    .where(
      and(eq(documents.id, id), eq(documents.status, "draft"), sql`${documents.number} IS NULL`),
    );

  const statements: D1PreparedStatement[] = [
    guardedActivity(d1, activityOf(id, data.clientId ?? doc.clientId, "updated", ctx), guard, [id]),
  ];
  if (data.lines) {
    statements.push(deleteLines(d1, id, guard, [id]), insertLines(d1, id, data.lines, guard, [id]));
  }
  if (data.customFields) {
    statements.push(...replaceCustomFields(d1, id, data.customFields, guard, [id]));
  }
  statements.push(toStatement(d1, update));
  const results = await d1.batch(statements);
  if (changes(results.at(-1)) === 0) {
    throw new AppError(409, "document_locked", "Only an unsent draft can be edited");
  }
}

/**
 * Deletes an unsent draft. A document with a number (sent, or "Ready to send" after a
 * failed send) cannot be deleted, so the numbering never has a gap. Void it instead.
 */
export async function deleteDraft(db: Db, id: string): Promise<void> {
  const doc = await loadDocument(db, id);
  if (isLocked(doc)) {
    throw new AppError(
      409,
      "document_locked",
      doc.kind === "invoice"
        ? "Only drafts can be deleted. Void the invoice instead"
        : "Only drafts can be deleted",
    );
  }
  const d1 = db.$client;
  const results = await d1.batch([
    d1
      .prepare(
        `DELETE FROM custom_field_values WHERE entity_type = 'document' AND entity_id = ?
         AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND ${UNNUMBERED_DRAFT})`,
      )
      .bind(id, id),
    d1.prepare(`DELETE FROM documents WHERE id = ? AND ${UNNUMBERED_DRAFT}`).bind(id),
  ]);
  if (changes(results[1]) === 0) {
    throw new AppError(409, "document_locked", "Only drafts can be deleted");
  }
}

/** Copies a document's content into a new draft of the same kind. */
export async function duplicateDocument(db: Db, id: string, ctx: ActionContext): Promise<string> {
  const source = await loadDocument(db, id);
  const lines = await loadLines(db, id);
  const values = await db
    .select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value })
    .from(customFieldValues)
    .where(and(eq(customFieldValues.entityType, "document"), eq(customFieldValues.entityId, id)));
  // A Member cannot create a document with auto-send reminders (R55).
  const reminderMode =
    source.reminderMode === "auto_send" && ctx.actor?.role !== "owner"
      ? "inherit"
      : source.reminderMode;

  const d1 = db.$client;
  const newId = crypto.randomUUID();
  const insert = db.insert(documents).values({
    id: newId,
    kind: source.kind,
    status: "draft",
    clientId: source.clientId,
    currency: source.currency,
    paymentTermsDays: source.paymentTermsDays,
    discountType: source.discountType,
    discountPercent: source.discountPercent,
    discountAmount: source.discountAmount,
    notes: source.notes,
    footerText: source.footerText,
    templateId: source.templateId,
    reminderMode,
    subtotal: source.subtotal,
    discountTotal: source.discountTotal,
    taxTotal: source.taxTotal,
    total: source.total,
    createdBy: ctx.actor?.id ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  await d1.batch([
    toStatement(d1, insert),
    insertLines(d1, newId, lines),
    ...replaceCustomFields(d1, newId, values),
    guardedActivity(
      d1,
      activityOf(newId, source.clientId, "duplicated", ctx, {
        sourceId: source.id,
        sourceNumber: source.number,
      }),
      "1",
      [],
    ),
  ]);
  return newId;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * The template for a document: the document override, then the client default, then the
 * workspace default, then the built-in classic config.
 */
export async function resolveTemplate(
  db: Db,
  ws: Workspace,
  documentTemplateId: string | null,
  clientTemplateId: string | null,
): Promise<DocumentSnapshot["template"]> {
  for (const templateId of [documentTemplateId, clientTemplateId, ws.defaultTemplateId]) {
    if (!templateId) continue;
    const [row] = await db
      .select({ id: templates.id, name: templates.name, config: templates.config })
      .from(templates)
      .where(eq(templates.id, templateId));
    if (row) return { id: row.id, name: row.name, config: normalizeTemplateConfig(row.config) };
  }
  return { id: null, name: "Default", config: DEFAULT_TEMPLATE_CONFIG };
}

/**
 * The custom fields for a snapshot. `documentValues`, when present, replaces the stored
 * document-scope values (a revise builds the snapshot before it writes the new values).
 */
async function resolveCustomFields(
  db: Db,
  documentId: string,
  clientId: string,
  documentValues?: { fieldId: string; value: string }[],
): Promise<SnapshotCustomField[]> {
  const defs = await db
    .select()
    .from(customFieldDefs)
    .where(sql`${customFieldDefs.archivedAt} IS NULL`)
    .orderBy(asc(customFieldDefs.sortOrder), asc(customFieldDefs.createdAt));
  if (defs.length === 0) return [];
  const values = await db
    .select()
    .from(customFieldValues)
    .where(
      sql`(${customFieldValues.entityType} = 'workspace' AND ${customFieldValues.entityId} = 'workspace')
       OR (${customFieldValues.entityType} = 'client' AND ${customFieldValues.entityId} = ${clientId})
       OR (${customFieldValues.entityType} = 'document' AND ${customFieldValues.entityId} = ${documentId})`,
    );
  const result: SnapshotCustomField[] = [];
  for (const def of defs) {
    const entityId =
      def.scope === "workspace" ? "workspace" : def.scope === "client" ? clientId : documentId;
    const value =
      def.scope === "document" && documentValues
        ? documentValues.find((v) => v.fieldId === def.id)?.value
        : values.find(
            (v) => v.fieldId === def.id && v.entityType === def.scope && v.entityId === entityId,
          )?.value;
    if (value) {
      result.push({
        fieldId: def.id,
        label: def.label,
        type: def.type,
        section: def.section,
        value,
      });
    }
  }
  return result;
}

export interface SnapshotInput {
  ws: Workspace;
  doc: Document;
  lines: Pick<LineInputData, "description" | "quantity" | "unitPrice" | "taxRateId">[];
  number: string | null;
  revisionNumber: number;
  issueDate: string;
  dueDate: string | null;
  expiryDate: string | null;
  fx: FxRate | null;
  now: number;
  /** New document custom field values that are not stored yet. */
  documentFieldValues?: { fieldId: string; value: string }[];
}

/** Builds the full snapshot from live data: client, brand kit, template, and custom fields. */
async function assembleSnapshot(db: Db, input: SnapshotInput): Promise<DocumentSnapshot> {
  const { ws, doc, lines } = input;
  const discount = discountFromRow(doc);
  const rates = await loadTaxRates(
    db,
    lines.map((l) => l.taxRateId).filter((v): v is string => Boolean(v)),
  );
  const totals = computeTotals(doc.currency, lines, discount, rates);
  const homeTotals = input.fx
    ? convertTotals(totals, doc.currency, ws.homeCurrency, input.fx.rate)
    : null;

  const [[client], [contact], brandKit, customFields] = await Promise.all([
    db
      .select({
        id: clients.id,
        name: clients.name,
        billingAddress: clients.billingAddress,
        taxId: clients.taxId,
        templateId: clients.templateId,
      })
      .from(clients)
      .where(eq(clients.id, doc.clientId)),
    db
      .select({ name: clientContacts.name, email: clientContacts.email })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, doc.clientId))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt))
      .limit(1),
    brandKitOf(ws),
    resolveCustomFields(db, doc.id, doc.clientId, input.documentFieldValues),
  ]);
  if (!client) throw new AppError(409, "client_missing", "The client of this document is missing");
  const template = await resolveTemplate(db, ws, doc.templateId, client.templateId);

  return {
    version: 1,
    document: {
      id: doc.id,
      kind: doc.kind,
      number: input.number,
      revisionNumber: input.revisionNumber,
      currency: doc.currency,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      expiryDate: input.expiryDate,
      paymentTermsDays: doc.paymentTermsDays,
      discount,
      notes: doc.notes,
      footerText: doc.footerText,
    },
    lines: lines.map((line, position) => {
      const rate = line.taxRateId ? rates.get(line.taxRateId) : undefined;
      const lineTotals = totals.lines[position];
      return {
        position,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        tax: rate ? { id: rate.id, name: rate.name, rate: rate.rate, note: rate.note } : null,
        amount: lineTotals?.amount ?? 0,
        discount: lineTotals?.discount ?? 0,
        net: lineTotals?.net ?? 0,
        taxAmount: lineTotals?.tax ?? 0,
      };
    }),
    totals,
    fx: input.fx
      ? {
          homeCurrency: ws.homeCurrency,
          rate: input.fx.rate,
          rateDate: input.fx.rateDate,
          provider: input.fx.provider,
          overridden: input.fx.provider === "manual",
        }
      : null,
    homeTotals,
    client: {
      id: client.id,
      name: client.name,
      billingAddress: client.billingAddress,
      taxId: client.taxId,
      contact: contact ?? null,
    },
    brandKit,
    template,
    customFields,
    createdAt: input.now,
  };
}

function storedFx(doc: Document): FxRate | null {
  if (!doc.fxRate || !doc.fxRateDate || !doc.fxProvider) return null;
  return {
    status: "ok",
    rate: doc.fxRate,
    rateScaled: doc.fxRateScaled ?? rateToScaled(doc.fxRate),
    rateDate: doc.fxRateDate,
    provider: doc.fxProvider,
    cached: true,
  };
}

function dueDateFor(ws: Workspace, doc: Document, issueDate: string, clientTerms: number | null) {
  if (doc.kind !== "invoice") return null;
  if (doc.dueDate) return doc.dueDate;
  const terms = doc.paymentTermsDays ?? clientTerms ?? ws.defaultPaymentTermsDays;
  return addDays(issueDate, terms);
}

function expiryDateFor(ws: Workspace, doc: Document, issueDate: string) {
  if (doc.kind !== "quote") return null;
  return doc.expiryDate ?? addDays(issueDate, ws.defaultQuoteValidityDays);
}

async function clientTerms(db: Db, clientId: string): Promise<number | null> {
  const [row] = await db
    .select({ terms: clients.paymentTermsDays })
    .from(clients)
    .where(eq(clients.id, clientId));
  return row?.terms ?? null;
}

/**
 * A transient snapshot for previews (U10 `/render/draft/:id`). It allocates no number and
 * writes nothing. FX uses the stored rate, or `getRate` when a fetcher is passed.
 */
export async function buildSnapshot(
  db: Db,
  documentId: string,
  opts: { now: number; fetcher?: Fetcher },
): Promise<DocumentSnapshot> {
  const [ws, doc, lines] = await Promise.all([
    loadWorkspace(db),
    loadDocument(db, documentId),
    loadLines(db, documentId),
  ]);
  const issueDate = doc.issueDate ?? workspaceToday(ws, opts.now);
  let fx = storedFx(doc);
  if (!fx && opts.fetcher) {
    const result = await getRate(db, opts.fetcher, {
      from: doc.currency,
      to: ws.homeCurrency,
      date: issueDate,
      now: opts.now,
    });
    fx = result.status === "ok" ? result : null;
  }
  if (!fx && doc.currency === ws.homeCurrency) fx = manualIdentity(issueDate);
  return assembleSnapshot(db, {
    ws,
    doc,
    lines,
    number: doc.number,
    revisionNumber: 0,
    issueDate,
    dueDate: dueDateFor(ws, doc, issueDate, await clientTerms(db, doc.clientId)),
    expiryDate: expiryDateFor(ws, doc, issueDate),
    fx,
    now: opts.now,
  });
}

function manualIdentity(date: string): FxRate {
  return {
    status: "ok",
    rate: "1",
    rateScaled: rateToScaled("1"),
    rateDate: date,
    provider: "identity",
    cached: false,
  };
}

/** Columns of document_revisions after the snapshot, in insert order. */
const REVISION_COLUMNS = `id, document_id, revision_number, snapshot, kind, status, client_id,
  issue_date, due_date, currency, subtotal, discount_total, tax_total, total, home_currency,
  fx_rate, home_subtotal, home_discount_total, home_tax_total, home_total, created_by, created_at`;

/**
 * Inserts a revision from the snapshot, with its report columns and per-rate tax rows.
 * The snapshot's number comes from the document row, so finalize can write the number
 * allocated earlier in the same batch. Runs only when the document's
 * current_revision_id equals the new revision ID.
 */
function revisionStatements(
  d1: D1Database,
  revisionId: string,
  snapshot: DocumentSnapshot,
  actorUserId: string | null,
  now: number,
): D1PreparedStatement[] {
  const home = snapshot.homeTotals;
  const fx = snapshot.fx;
  if (!home || !fx) throw new Error("A revision needs home-currency totals");
  const doc = snapshot.document;
  const insertRevision = d1
    .prepare(
      `INSERT INTO document_revisions (${REVISION_COLUMNS})
       SELECT ?, d.id, ?, json_set(?, '$.document.number', d.number), d.kind, d.status,
              d.client_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM documents d WHERE d.id = ? AND d.current_revision_id = ?`,
    )
    .bind(
      revisionId,
      doc.revisionNumber,
      JSON.stringify(snapshot),
      doc.issueDate,
      doc.dueDate,
      doc.currency,
      snapshot.totals.subtotal,
      snapshot.totals.discount,
      snapshot.totals.taxTotal,
      snapshot.totals.total,
      fx.homeCurrency,
      fx.rate,
      home.subtotal,
      home.discount,
      home.taxTotal,
      home.total,
      actorUserId,
      now,
      doc.id,
      revisionId,
    );
  const taxRows = snapshot.totals.taxes.map((row, i) => ({
    taxRateId: row.taxId,
    name: row.name ?? "",
    rate: row.rate,
    taxable: row.taxable,
    tax: row.tax,
    homeTaxable: home.taxes[i]?.taxable ?? 0,
    homeTax: home.taxes[i]?.tax ?? 0,
  }));
  const insertTaxes = d1
    .prepare(
      `INSERT INTO revision_tax_totals (revision_id, tax_rate_id, document_id, issue_date, name, rate,
         taxable, tax, home_taxable, home_tax)
       SELECT ?, json_extract(value, '$.taxRateId'), ?, ?, json_extract(value, '$.name'),
              json_extract(value, '$.rate'), json_extract(value, '$.taxable'),
              json_extract(value, '$.tax'), json_extract(value, '$.homeTaxable'),
              json_extract(value, '$.homeTax')
       FROM json_each(?) WHERE EXISTS (SELECT 1 FROM document_revisions WHERE id = ?)`,
    )
    .bind(revisionId, doc.id, doc.issueDate, JSON.stringify(taxRows), revisionId);
  return [insertRevision, insertTaxes];
}

// ---------------------------------------------------------------------------
// Finalize and send
// ---------------------------------------------------------------------------

export interface FinalizeOptions extends ActionContext {
  /** Overrides the draft's issue date. Defaults to the draft's date, then today. */
  issueDate?: string;
  /** For the FX fetch. Defaults to global fetch. */
  fetcher?: Fetcher;
  /**
   * The document row, when the caller loaded it with no write since. It saves one D1
   * statement. The writes stay guarded on the draft state.
   */
  document?: Document;
}

export interface FinalizeResult {
  document: Document;
  revision: DocumentRevision;
  /** True when this call allocated the number. False when it returned the existing one. */
  allocated: boolean;
}

async function loadRevision(db: Db, revisionId: string): Promise<DocumentRevision> {
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(eq(documentRevisions.id, revisionId));
  if (!revision) throw new AppError(404, "revision_not_found", "This revision does not exist");
  return revision;
}

async function existingFinalized(db: Db, doc: Document): Promise<FinalizeResult> {
  if (doc.status === "void") {
    throw new AppError(409, "document_void", "This invoice is void");
  }
  if (!doc.currentRevisionId) {
    throw new AppError(409, "invalid_status", "This document cannot be finalized");
  }
  return {
    document: doc,
    revision: await loadRevision(db, doc.currentRevisionId),
    allocated: false,
  };
}

/**
 * Allocates the number, freezes the snapshot as revision 1, and sets status `finalized`
 * (invoices) or keeps `draft` with a number (quotes, whose statuses have no "finalized").
 * Idempotent: a document that already has a number returns its current revision.
 * Throws 409 `fx_rate_required` before any number is used when the rate cannot be fetched.
 * Call `markSent` after the email provider accepts the message.
 */
export async function finalize(
  db: Db,
  documentId: string,
  opts: FinalizeOptions,
): Promise<FinalizeResult> {
  const doc = opts.document ?? (await loadDocument(db, documentId));
  if (isLocked(doc)) return existingFinalized(db, doc);

  const [ws, lines, terms] = await Promise.all([
    loadWorkspace(db),
    loadLines(db, documentId),
    clientTerms(db, doc.clientId),
  ]);
  if (lines.length === 0) {
    throw new AppError(422, "no_lines", "Add at least one line before sending");
  }
  const issueDate = opts.issueDate ?? doc.issueDate ?? workspaceToday(ws, opts.now);

  let fx: FxRate;
  const manual = doc.fxOverridden ? storedFx(doc) : null;
  if (manual) {
    fx = manual;
  } else {
    const result = await getRate(db, opts.fetcher ?? ((input, init) => fetch(input, init)), {
      from: doc.currency,
      to: ws.homeCurrency,
      date: issueDate,
      now: opts.now,
    });
    if (result.status !== "ok") {
      throw new AppError(409, "fx_rate_required", result.message);
    }
    fx = result;
  }

  const dueDate = dueDateFor(ws, doc, issueDate, terms);
  const expiryDate = expiryDateFor(ws, doc, issueDate);
  const snapshot = await assembleSnapshot(db, {
    ws,
    doc,
    lines,
    number: null,
    revisionNumber: 1,
    issueDate,
    dueDate,
    expiryDate,
    fx,
    now: opts.now,
  });
  const totals = snapshot.totals;

  const d1 = db.$client;
  const revisionId = crypto.randomUUID();
  const actorUserId = opts.actor?.id ?? null;
  const prefix = doc.kind === "invoice" ? ws.invoicePrefix : ws.quotePrefix;
  const numberSql = numberExpression(doc.kind, prefix, ws.numberPadding);
  const newStatus = doc.kind === "invoice" ? "finalized" : "draft";
  const updateDocument = d1
    .prepare(
      `UPDATE documents SET number = ${numberSql.sql}, status = ?, issue_date = ?, due_date = ?,
         expiry_date = ?, fx_rate = ?, fx_rate_scaled = ?, fx_rate_date = ?, fx_provider = ?,
         public_token = coalesce(public_token, ?), current_revision_id = ?, revision_count = 1,
         subtotal = ?, discount_total = ?, tax_total = ?, total = ?, is_overdue = 0,
         finalized_at = ?, updated_at = ?
       WHERE id = ? AND ${UNNUMBERED_DRAFT}`,
    )
    .bind(
      ...numberSql.params,
      newStatus,
      issueDate,
      dueDate,
      expiryDate,
      fx.rate,
      fx.rateScaled,
      fx.rateDate,
      fx.provider,
      newPublicToken(),
      revisionId,
      totals.subtotal,
      totals.discount,
      totals.taxTotal,
      totals.total,
      opts.now,
      opts.now,
      documentId,
    );
  const guard = "EXISTS (SELECT 1 FROM documents WHERE id = ? AND current_revision_id = ?)";
  const results = await d1.batch([
    counterIncrement(d1, doc.kind, documentId),
    updateDocument,
    ...revisionStatements(d1, revisionId, snapshot, actorUserId, opts.now),
    guardedActivity(
      d1,
      activityOf(documentId, doc.clientId, "finalized", opts, { revisionId, revisionNumber: 1 }),
      guard,
      [documentId, revisionId],
    ),
  ]);
  const document = await loadDocument(db, documentId);
  if (changes(results[1]) === 0) return existingFinalized(db, document);
  return { document, revision: await loadRevision(db, revisionId), allocated: true };
}

/**
 * Marks a finalized document as sent after the email provider accepted it (U13). A resend
 * of a sent document only logs the activity.
 */
export async function markSent(
  db: Db,
  documentId: string,
  opts: ActionContext & {
    revisionId: string;
    trigger?: "manual" | "auto";
    /**
     * The document row, when the caller loaded it with no write since. It saves one D1
     * statement. The update stays guarded on the status of this row.
     */
    document?: Document;
  },
): Promise<Document> {
  const doc = opts.document ?? (await loadDocument(db, documentId));
  if (doc.number === null) {
    throw new AppError(409, "not_finalized", "Finalize the document before marking it sent");
  }
  if (doc.status === "void") throw new AppError(409, "document_void", "This invoice is void");
  const firstSend =
    (doc.kind === "invoice" && doc.status === "finalized") ||
    (doc.kind === "quote" && doc.status === "draft");
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, opts.now);
  const status = firstSend ? "sent" : doc.status;
  const overdue = isOverdue({ ...doc, status }, today);

  const d1 = db.$client;
  const statements: D1PreparedStatement[] = [
    guardedActivity(
      d1,
      activityOf(documentId, doc.clientId, "sent", opts, {
        revisionId: opts.revisionId,
        trigger: opts.trigger ?? "manual",
      }),
      "EXISTS (SELECT 1 FROM documents WHERE id = ? AND status = ?)",
      [documentId, doc.status],
    ),
    d1
      .prepare(
        `UPDATE documents SET status = ?, sent_at = coalesce(sent_at, ?), is_overdue = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
      )
      .bind(status, opts.now, overdue ? 1 : 0, opts.now, documentId, doc.status),
  ];
  const results = await d1.batch(statements);
  // The guarded update applied, so the new row is known without a read. This keeps a
  // scheduler document send inside the D1 query budget.
  if (changes(results[1]) === 1) {
    return {
      ...doc,
      status,
      sentAt: doc.sentAt ?? opts.now,
      isOverdue: overdue,
      updatedAt: opts.now,
    };
  }
  return loadDocument(db, documentId);
}

// ---------------------------------------------------------------------------
// Revise, void, convert
// ---------------------------------------------------------------------------

/**
 * Revises a sent invoice with no payments (R41): applies the edits to the live row and
 * writes revision n+1 with the same number and a new snapshot. Overdue invoices are
 * stored as "sent", so they qualify too.
 */
export async function revise(
  db: Db,
  documentId: string,
  data: DocumentUpdateData,
  opts: ActionContext & { fetcher?: Fetcher },
): Promise<{ document: Document; revision: DocumentRevision }> {
  const doc = await loadDocument(db, documentId);
  if (doc.kind !== "invoice" || doc.status !== "sent") {
    throw new AppError(409, "revise_not_allowed", "Only a sent invoice can be revised");
  }
  const [paymentRow] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.documentId, documentId))
    .limit(1);
  if (doc.amountPaid > 0 || paymentRow) {
    throw new AppError(
      409,
      "revise_has_payments",
      "An invoice with payments cannot be revised. Delete the payments first",
    );
  }
  assertReminderModeAllowed(opts.actor, doc.reminderMode, data.reminderMode);
  if (data.clientId && data.clientId !== doc.clientId) await assertClient(db, data.clientId);
  if (data.templateId !== undefined) await assertTemplate(db, data.templateId);
  await assertCustomFields(db, data.customFields);

  const [ws, existing] = await Promise.all([loadWorkspace(db), loadLines(db, documentId)]);
  const lines = data.lines ?? existing;
  if (lines.length === 0) throw new AppError(422, "no_lines", "Add at least one line");
  const existingTaxIds = new Set(existing.map((l) => l.taxRateId).filter((v): v is string => !!v));
  await validateLineTaxes(db, lines, existingTaxIds);

  const issueDate = data.issueDate ?? doc.issueDate ?? workspaceToday(ws, opts.now);
  const merged: Document = {
    ...doc,
    clientId: data.clientId ?? doc.clientId,
    currency: data.currency ?? doc.currency,
    issueDate,
    paymentTermsDays:
      data.paymentTermsDays !== undefined ? data.paymentTermsDays : doc.paymentTermsDays,
    ...(data.discount ? discountColumns(data.discount) : {}),
    notes: data.notes !== undefined ? data.notes : doc.notes,
    footerText: data.footerText !== undefined ? data.footerText : doc.footerText,
    templateId: data.templateId !== undefined ? data.templateId : doc.templateId,
    reminderMode: data.reminderMode ?? doc.reminderMode,
  };
  const termsChanged =
    data.dueDate === null ||
    (data.dueDate === undefined &&
      (data.paymentTermsDays !== undefined || data.issueDate !== undefined));
  merged.dueDate = data.dueDate
    ? data.dueDate
    : termsChanged
      ? dueDateFor(
          ws,
          { ...merged, dueDate: null },
          issueDate,
          await clientTerms(db, merged.clientId),
        )
      : doc.dueDate;

  // FX: a new manual rate wins. Clearing it or changing the currency refetches. A new date
  // refetches only when the rate is not manual.
  await assertManualRate(db, merged.currency, data.fxRate);
  let fx: FxRate | null;
  if (data.fxRate) {
    fx = manualRate(data.fxRate.rate, data.fxRate.date);
  } else if (
    data.fxRate === null ||
    merged.currency !== doc.currency ||
    (!doc.fxOverridden && issueDate !== doc.issueDate)
  ) {
    const result = await getRate(db, opts.fetcher ?? ((input, init) => fetch(input, init)), {
      from: merged.currency,
      to: ws.homeCurrency,
      date: issueDate,
      now: opts.now,
    });
    if (result.status !== "ok") throw new AppError(409, "fx_rate_required", result.message);
    fx = result;
  } else {
    fx = storedFx(doc);
  }
  if (!fx) throw new AppError(409, "fx_rate_required", "Enter an exchange rate");
  merged.fxRate = fx.rate;
  merged.fxRateScaled = fx.rateScaled;
  merged.fxRateDate = fx.rateDate;
  merged.fxProvider = fx.provider;
  merged.fxOverridden = fx.provider === "manual";

  const revisionNumber = doc.revisionCount + 1;
  const snapshot = await assembleSnapshot(db, {
    ws,
    doc: merged,
    lines,
    number: doc.number,
    revisionNumber,
    issueDate,
    dueDate: merged.dueDate,
    expiryDate: null,
    fx,
    now: opts.now,
    documentFieldValues: data.customFields,
  });
  const totals = snapshot.totals;
  const today = workspaceToday(ws, opts.now);
  const overdue = isOverdue({ ...merged, total: totals.total, amountPaid: 0 }, today);

  const d1 = db.$client;
  const revisionId = crypto.randomUUID();
  const update = db
    .update(documents)
    .set({
      clientId: merged.clientId,
      currency: merged.currency,
      issueDate,
      dueDate: merged.dueDate,
      paymentTermsDays: merged.paymentTermsDays,
      discountType: merged.discountType,
      discountPercent: merged.discountPercent,
      discountAmount: merged.discountAmount,
      notes: merged.notes,
      footerText: merged.footerText,
      templateId: merged.templateId,
      reminderMode: merged.reminderMode,
      fxRate: merged.fxRate,
      fxRateScaled: merged.fxRateScaled,
      fxRateDate: merged.fxRateDate,
      fxProvider: merged.fxProvider,
      fxOverridden: merged.fxOverridden,
      currentRevisionId: revisionId,
      revisionCount: revisionNumber,
      subtotal: totals.subtotal,
      discountTotal: totals.discount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      isOverdue: overdue,
      updatedAt: opts.now,
    })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.status, "sent"),
        eq(documents.amountPaid, 0),
        eq(documents.revisionCount, doc.revisionCount),
        sql`NOT EXISTS (SELECT 1 FROM payments WHERE document_id = ${documentId})`,
      ),
    );
  const guard = "EXISTS (SELECT 1 FROM documents WHERE id = ? AND current_revision_id = ?)";
  const guardParams = [documentId, revisionId];
  const statements: D1PreparedStatement[] = [toStatement(d1, update)];
  if (data.lines) {
    statements.push(
      deleteLines(d1, documentId, guard, guardParams),
      insertLines(d1, documentId, data.lines, guard, guardParams),
    );
  }
  if (data.customFields) {
    statements.push(...replaceCustomFields(d1, documentId, data.customFields, guard, guardParams));
  }
  statements.push(
    ...revisionStatements(d1, revisionId, snapshot, opts.actor?.id ?? null, opts.now),
    guardedActivity(
      d1,
      activityOf(documentId, merged.clientId, "revised", opts, { revisionId, revisionNumber }),
      guard,
      guardParams,
    ),
  );
  const results = await d1.batch(statements);
  if (changes(results[0]) === 0) {
    throw new AppError(409, "revise_conflict", "The invoice changed. Reload and try again");
  }
  return {
    document: await loadDocument(db, documentId),
    revision: await loadRevision(db, revisionId),
  };
}

/** Voids a finalized or sent invoice with no payments (R43). Overdue counts as sent. */
export async function voidDocument(
  db: Db,
  documentId: string,
  ctx: ActionContext,
): Promise<Document> {
  const doc = await loadDocument(db, documentId);
  if (doc.kind !== "invoice")
    throw new AppError(409, "invalid_status", "Only invoices can be voided");
  if (doc.status === "void") return doc;
  const [paymentRow] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.documentId, documentId))
    .limit(1);
  if (doc.amountPaid > 0 || paymentRow) {
    throw new AppError(
      409,
      "void_has_payments",
      "An invoice with payments cannot be voided. Delete the payments first",
    );
  }
  if (doc.status !== "finalized" && doc.status !== "sent") {
    throw new AppError(409, "invalid_status", "Only a sent invoice can be voided");
  }
  const condition = `id = ? AND kind = 'invoice' AND status IN ('finalized', 'sent') AND amount_paid = 0
    AND NOT EXISTS (SELECT 1 FROM payments WHERE document_id = ?)`;
  const d1 = db.$client;
  const results = await d1.batch([
    guardedActivity(
      d1,
      activityOf(documentId, doc.clientId, "voided", ctx, { previousStatus: doc.status }),
      `EXISTS (SELECT 1 FROM documents WHERE ${condition})`,
      [documentId, documentId],
    ),
    d1
      .prepare(
        `UPDATE documents SET status = 'void', voided_at = ?, is_overdue = 0, updated_at = ?
         WHERE ${condition}`,
      )
      .bind(ctx.now, ctx.now, documentId, documentId),
  ]);
  if (changes(results[1]) === 0) {
    throw new AppError(409, "void_conflict", "The invoice changed. Reload and try again");
  }
  return loadDocument(db, documentId);
}

/**
 * Replaces the public link token, so every link sent before stops working. Use it when a
 * link went to the wrong person. Emails sent after this use the new link.
 */
export async function resetPublicLink(
  db: Db,
  documentId: string,
  ctx: ActionContext,
): Promise<Document> {
  const doc = await loadDocument(db, documentId);
  if (!doc.publicToken) {
    throw new AppError(409, "no_public_link", "This document has no public link yet");
  }
  const d1 = db.$client;
  const condition = "id = ? AND public_token = ?";
  const results = await d1.batch([
    guardedActivity(
      d1,
      activityOf(documentId, doc.clientId, "link_reset", ctx),
      `EXISTS (SELECT 1 FROM documents WHERE ${condition})`,
      [documentId, doc.publicToken],
    ),
    d1
      .prepare(`UPDATE documents SET public_token = ?, updated_at = ? WHERE ${condition}`)
      .bind(newPublicToken(), ctx.now, documentId, doc.publicToken),
  ]);
  if (changes(results[1]) === 0) {
    throw new AppError(409, "link_reset_conflict", "The link changed. Reload and try again");
  }
  return loadDocument(db, documentId);
}

/**
 * Converts an accepted quote into a draft invoice with copied lines, and marks the quote
 * converted, in one batch. A quote converts once (R45, AE6).
 */
export async function convertQuote(db: Db, quoteId: string, ctx: ActionContext): Promise<string> {
  const quote = await loadDocument(db, quoteId);
  if (quote.kind !== "quote")
    throw new AppError(409, "invalid_status", "Only quotes can be converted");
  if (quote.status === "converted" || quote.convertedInvoiceId) {
    throw new AppError(409, "already_converted", "This quote was already converted");
  }
  if (quote.status !== "accepted") {
    throw new AppError(409, "quote_not_accepted", "Only an accepted quote can be converted");
  }
  const lines = await loadLines(db, quoteId);
  const values = await db
    .select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value })
    .from(customFieldValues)
    .where(
      and(eq(customFieldValues.entityType, "document"), eq(customFieldValues.entityId, quoteId)),
    );

  const d1 = db.$client;
  const invoiceId = crypto.randomUUID();
  const open = `EXISTS (SELECT 1 FROM documents WHERE id = ? AND status = 'accepted' AND converted_invoice_id IS NULL)`;
  const created = "EXISTS (SELECT 1 FROM documents WHERE id = ?)";
  const results = await d1.batch([
    guardedActivity(
      d1,
      activityOf(quoteId, quote.clientId, "converted", ctx, { invoiceId }),
      open,
      [quoteId],
    ),
    d1
      .prepare(
        `UPDATE documents SET status = 'converted', converted_invoice_id = ?, updated_at = ?
         WHERE id = ? AND status = 'accepted' AND converted_invoice_id IS NULL`,
      )
      .bind(invoiceId, ctx.now, quoteId),
    d1
      .prepare(
        `INSERT INTO documents (id, kind, status, client_id, currency, payment_terms_days,
           discount_type, discount_percent, discount_amount, notes, footer_text, template_id,
           reminder_mode, subtotal, discount_total, tax_total, total, source_quote_id,
           created_by, created_at, updated_at)
         SELECT ?, 'invoice', 'draft', client_id, currency, NULL, discount_type, discount_percent,
           discount_amount, notes, footer_text, template_id, 'inherit', subtotal, discount_total,
           tax_total, total, id, ?, ?, ?
         FROM documents WHERE id = ? AND converted_invoice_id = ?`,
      )
      .bind(invoiceId, ctx.actor?.id ?? null, ctx.now, ctx.now, quoteId, invoiceId),
    insertLines(d1, invoiceId, lines, created, [invoiceId]),
    ...replaceCustomFields(d1, invoiceId, values, created, [invoiceId]),
    guardedActivity(
      d1,
      activityOf(invoiceId, quote.clientId, "created", ctx, {
        kind: "invoice",
        sourceQuoteId: quoteId,
        sourceQuoteNumber: quote.number,
      }),
      created,
      [invoiceId],
    ),
  ]);
  if (changes(results[1]) === 0) {
    throw new AppError(409, "already_converted", "This quote was already converted");
  }
  return invoiceId;
}

// ---------------------------------------------------------------------------
// Quote decisions (U11)
// ---------------------------------------------------------------------------

export async function getDocumentByToken(db: Db, token: string): Promise<Document | null> {
  if (!token) return null;
  const [doc] = await db.select().from(documents).where(eq(documents.publicToken, token));
  return doc ?? null;
}

/**
 * Records the client's accept or decline on a sent quote, from the public page. Accept is
 * blocked after the expiry date. A decision is final (R45). `opts.job`, when set, gives the
 * notification job. It is queued in the same batch, and only when the decision is stored.
 */
export async function decideQuote(
  db: Db,
  token: string,
  input: { decision: "accept" | "decline"; comment?: string | null },
  opts: { now: number; job?: (decided: Document) => EnqueueInput },
): Promise<Document> {
  const doc = await getDocumentByToken(db, token);
  if (doc?.kind !== "quote") {
    throw new AppError(404, "not_found", "Not found");
  }
  const comment = input.comment?.trim() || null;
  if (comment && comment.length > MAX_DECISION_COMMENT) {
    throw new AppError(400, "comment_too_long", `Use ${MAX_DECISION_COMMENT} characters or fewer`);
  }
  if (["accepted", "declined", "converted"].includes(doc.status)) {
    throw new AppError(409, "quote_decided", "This quote already has a decision");
  }
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, opts.now);
  if (doc.status === "expired" || (doc.expiryDate !== null && doc.expiryDate < today)) {
    throw new AppError(409, "quote_expired", "This quote has expired");
  }
  if (doc.status !== "sent") {
    throw new AppError(409, "invalid_status", "This quote cannot be decided");
  }
  const status = input.decision === "accept" ? "accepted" : "declined";
  const d1 = db.$client;
  const results = await d1.batch([
    guardedActivity(
      d1,
      {
        documentId: doc.id,
        clientId: doc.clientId,
        type: status === "accepted" ? "quote_accepted" : "quote_declined",
        data: comment ? { comment } : null,
        now: opts.now,
      },
      "EXISTS (SELECT 1 FROM documents WHERE id = ? AND status = 'sent')",
      [doc.id],
    ),
    d1
      .prepare(
        `UPDATE documents SET status = ?, decided_at = ?, decision_comment = ?, updated_at = ?
         WHERE id = ? AND status = 'sent'`,
      )
      .bind(status, opts.now, comment, opts.now, doc.id),
    ...(opts.job
      ? [
          guardedEnqueueStatement(
            d1,
            opts.job({ ...doc, status, decidedAt: opts.now, decisionComment: comment }),
            opts.now,
            "EXISTS (SELECT 1 FROM documents WHERE id = ? AND status = ? AND decided_at = ?)",
            [doc.id, status, opts.now],
          ),
        ]
      : []),
  ]);
  if (changes(results[1]) === 0) {
    throw new AppError(409, "quote_decided", "This quote already has a decision");
  }
  return loadDocument(db, doc.id);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function summaryOf(
  doc: Pick<
    Document,
    | "id"
    | "kind"
    | "status"
    | "number"
    | "clientId"
    | "currency"
    | "issueDate"
    | "dueDate"
    | "expiryDate"
    | "total"
    | "amountPaid"
    | "isOverdue"
    | "updatedAt"
  >,
  clientName: string,
  today: string,
  needsReview: boolean,
): DocumentSummary {
  return {
    id: doc.id,
    kind: doc.kind,
    status: doc.status,
    displayStatus: displayStatus(doc, today),
    number: doc.number,
    clientId: doc.clientId,
    clientName,
    currency: doc.currency,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    expiryDate: doc.expiryDate,
    total: doc.total,
    amountPaid: doc.amountPaid,
    balance: doc.total - doc.amountPaid,
    isOverdue: isOverdue(doc, today),
    updatedAt: doc.updatedAt,
    needsReview,
  };
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function listDocuments(
  db: Db,
  rawQuery: DocumentListQuery,
  opts: { now: number },
): Promise<{ items: DocumentSummary[]; total: number; page: number; pageSize: number }> {
  const query = documentListQuery.parse(rawQuery);
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, opts.now);
  const conditions: SQL[] = [];
  if (query.kind) conditions.push(eq(documents.kind, query.kind));
  if (query.clientId) conditions.push(eq(documents.clientId, query.clientId));
  if (query.status === "overdue") conditions.push(overdueSql(today, "documents."));
  else if (query.status) {
    conditions.push(inArray(documents.status, query.status.split(",") as Document["status"][]));
  }
  if (query.filter === "unpaid") {
    conditions.push(inArray(documents.status, [...OPEN_STATUSES]));
  } else if (query.filter === "overdue") {
    conditions.push(overdueSql(today, "documents."));
  } else if (query.filter === "drafts") {
    conditions.push(eq(documents.status, "draft"));
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    conditions.push(
      sql`(${documents.number} LIKE ${pattern} ESCAPE '\\' OR ${clients.name} LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: documents.id,
        kind: documents.kind,
        status: documents.status,
        number: documents.number,
        clientId: documents.clientId,
        clientName: clients.name,
        currency: documents.currency,
        issueDate: documents.issueDate,
        dueDate: documents.dueDate,
        expiryDate: documents.expiryDate,
        total: documents.total,
        amountPaid: documents.amountPaid,
        isOverdue: documents.isOverdue,
        updatedAt: documents.updatedAt,
        summary: sql<
          string | null
        >`(SELECT description FROM document_lines WHERE document_id = ${documents.id} ORDER BY position LIMIT 1)`,
        needsReview: needsReviewSql(sql`${documents.id}`),
      })
      .from(documents)
      .innerJoin(clients, eq(documents.clientId, clients.id))
      .where(where)
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .innerJoin(clients, eq(documents.clientId, clients.id))
      .where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...summaryOf(row, row.clientName, today, Boolean(row.needsReview)),
      summary: row.summary || null,
    })),
    total: Number(count?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getDocumentDetail(
  db: Db,
  id: string,
  opts: { now: number },
): Promise<DocumentDetail> {
  const doc = await loadDocument(db, id);
  const [ws, lines, paymentRows, values, [client]] = await Promise.all([
    loadWorkspace(db),
    loadLines(db, id),
    db
      .select({
        id: payments.id,
        kind: payments.kind,
        amount: payments.amount,
        homeAmount: payments.homeAmount,
        paidOn: payments.paidOn,
        note: payments.note,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.documentId, id))
      .orderBy(asc(payments.paidOn), asc(payments.createdAt)),
    db
      .select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value })
      .from(customFieldValues)
      .where(and(eq(customFieldValues.entityType, "document"), eq(customFieldValues.entityId, id))),
    db
      .select({ name: clients.name, reviewJobId: reviewJobIdSql(sql`${id}`) })
      .from(clients)
      .where(eq(clients.id, doc.clientId)),
  ]);
  const today = workspaceToday(ws, opts.now);
  return {
    ...summaryOf(doc, client?.name ?? "", today, Boolean(client?.reviewJobId)),
    reviewJobId: client?.reviewJobId ?? null,
    paymentTermsDays: doc.paymentTermsDays,
    discount: discountFromRow(doc),
    notes: doc.notes,
    footerText: doc.footerText,
    templateId: doc.templateId,
    reminderMode: doc.reminderMode,
    fx: {
      rate: doc.fxRate,
      rateDate: doc.fxRateDate,
      provider: doc.fxProvider,
      overridden: doc.fxOverridden,
    },
    publicToken: doc.publicToken,
    currentRevisionId: doc.currentRevisionId,
    revisionCount: doc.revisionCount,
    subtotal: doc.subtotal,
    discountTotal: doc.discountTotal,
    taxTotal: doc.taxTotal,
    sourceQuoteId: doc.sourceQuoteId,
    convertedInvoiceId: doc.convertedInvoiceId,
    decidedAt: doc.decidedAt,
    decisionComment: doc.decisionComment,
    finalizedAt: doc.finalizedAt,
    sentAt: doc.sentAt,
    paidAt: doc.paidAt,
    voidedAt: doc.voidedAt,
    lines,
    payments: paymentRows,
    customFields: values,
  };
}

export async function listRevisions(db: Db, documentId: string): Promise<RevisionSummary[]> {
  await loadDocument(db, documentId);
  return db
    .select({
      id: documentRevisions.id,
      revisionNumber: documentRevisions.revisionNumber,
      issueDate: documentRevisions.issueDate,
      total: documentRevisions.total,
      createdAt: documentRevisions.createdAt,
    })
    .from(documentRevisions)
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.revisionNumber));
}

/** A revision with its typed snapshot, for rendering (U10, U11, U12). */
export async function getRevision(
  db: Db,
  revisionId: string,
): Promise<DocumentRevision & { snapshot: DocumentSnapshot }> {
  const revision = await loadRevision(db, revisionId);
  return revision as DocumentRevision & { snapshot: DocumentSnapshot };
}
