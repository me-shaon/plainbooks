// Recurring schedules (U15): schedules made from an invoice, period math in the workspace
// timezone, the enqueue hook, and the `recurring_issue` job that creates each invoice.
//
// Idempotency: one job per billing period, key `recurring:<scheduleId>:<periodId>`, and
// a unique index on documents(recurring_schedule_id, recurring_period_id). A retried job
// reuses the invoice it created before and never sends an invoice that is already sent.
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import type { SendMode, SendModeSetting } from "../../shared/domain";
import { calculateTotals } from "../../shared/money";
import {
  anchorDayOf,
  duePeriods,
  nextIssueDateFrom,
  occurrenceAfter,
  type PeriodRule,
  upcomingDates,
} from "../../shared/recurring";
import {
  type DiscountValue,
  displayStatus,
  documentCreateInput,
  type LineInputData,
} from "../../shared/schemas/document";
import type {
  RecurringCreateInput,
  RecurringDetail,
  RecurringSummary,
  RecurringUpdateData,
} from "../../shared/schemas/recurring";
import { recurringCreateInput } from "../../shared/schemas/recurring";
import { type Db, schema } from "../db/client";
import type { Client, RecurringSchedule, Workspace } from "../db/schema";
import { fxRateNeededEmail, recurringDraftReadyEmail } from "../email/templates";
import type { AuthUser } from "../env";
import { AppError } from "../errors";
import { createDraft, loadWorkspace, workspaceToday } from "./documents";
import {
  appDocumentUrl,
  hasEmailCapacity,
  nextEmailWindow,
  ownerEmails,
  SEND_EMAIL_JOB,
  type SendEmailJobPayload,
  sendDocument,
} from "./email";
import type { Fetcher } from "./fx";
import {
  type BatchStatement,
  type EnqueueInput,
  enqueueStatement,
  registerEnqueueHook,
  registerJobHandler,
} from "./jobs";

const {
  clients,
  documents,
  documentLines,
  notifications,
  recurringSchedules,
  recurringScheduleLines,
  taxRates,
} = schema;

export const RECURRING_JOB = "recurring_issue";
/** Periods one schedule enqueues per tick. A long outage catches up over a few ticks. */
export const CATCH_UP_LIMIT = 12;
/** Schedules the enqueue hook reads per tick. */
const HOOK_SCHEDULE_LIMIT = 50;

export interface RecurringJobPayload {
  scheduleId: string;
  periodId: string;
  issueDate: string;
}

let testFetcher: Fetcher | null = null;

/** Tests only: the fetch for the FX rate at auto-send. Pass null to restore it. */
export function setRecurringFetcherForTesting(fetcher: Fetcher | null): void {
  testFetcher = fetcher;
}

function fxFetcher(): Fetcher {
  return testFetcher ?? ((input, init) => fetch(input, init));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ruleOf(s: Pick<RecurringSchedule, "frequency" | "startDate" | "anchorDay">): PeriodRule {
  return { frequency: s.frequency, startDate: s.startDate, anchorDay: s.anchorDay };
}

/** The schedule setting, then the client setting, then the workspace default (R19, R20). */
export function resolveSendMode(
  schedule: SendModeSetting,
  client: SendModeSetting,
  workspace: SendMode,
): SendMode {
  if (schedule !== "inherit") return schedule;
  if (client !== "inherit") return client;
  return workspace;
}

/** R55: only an Owner can turn on auto-send, or change a setting that is already on. */
function assertSendModeAllowed(
  actor: AuthUser,
  before: SendModeSetting,
  after: SendModeSetting | undefined,
): void {
  if (actor.role === "owner" || after === undefined || after === before) return;
  if (after === "auto_send" || before === "auto_send") {
    throw new AppError(403, "owner_required", "Only an Owner can change auto-send settings");
  }
}

async function loadSchedule(db: Db, id: string): Promise<RecurringSchedule> {
  const [row] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id));
  if (!row) throw new AppError(404, "schedule_not_found", "This schedule does not exist");
  return row;
}

async function loadClient(db: Db, id: string): Promise<Client> {
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  if (!row) throw new AppError(404, "client_not_found", "This client does not exist");
  return row;
}

async function scheduleLines(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(recurringScheduleLines)
    .where(inArray(recurringScheduleLines.scheduleId, ids))
    .orderBy(asc(recurringScheduleLines.scheduleId), asc(recurringScheduleLines.position));
}

function discountOf(s: RecurringSchedule): DiscountValue {
  if (s.discountType === "percent") return { type: "percent", percent: s.discountPercent ?? "0" };
  if (s.discountType === "fixed") return { type: "fixed", amount: s.discountAmount ?? 0 };
  return { type: "none" };
}

function discountColumns(discount: DiscountValue) {
  return {
    discountType: discount.type,
    discountPercent: discount.type === "percent" ? discount.percent : null,
    discountAmount: discount.type === "fixed" ? discount.amount : null,
  };
}

function lineRows(scheduleId: string, lines: Omit<LineInputData, "id">[]) {
  return lines.map((line, position) => ({
    scheduleId,
    position,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRateId: line.taxRateId ?? null,
  }));
}

/** The total of one invoice. An invalid discount counts as none. */
async function totalsOf(
  db: Db,
  schedules: RecurringSchedule[],
  lines: Awaited<ReturnType<typeof scheduleLines>>,
): Promise<Map<string, number>> {
  const rateIds = [...new Set(lines.map((l) => l.taxRateId).filter((id): id is string => !!id))];
  const rates = rateIds.length
    ? await db.select().from(taxRates).where(inArray(taxRates.id, rateIds))
    : [];
  const rateById = new Map(rates.map((r) => [r.id, r]));
  const totals = new Map<string, number>();
  for (const s of schedules) {
    const own = lines.filter((l) => l.scheduleId === s.id);
    const input = (discount: DiscountValue) =>
      calculateTotals({
        currency: s.currency,
        discount: discount.type === "none" ? null : discount,
        lines: own.map((l) => {
          const rate = l.taxRateId ? rateById.get(l.taxRateId) : undefined;
          return {
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            tax: rate ? { id: rate.id, name: rate.name, rate: rate.rate } : null,
          };
        }),
      }).total;
    try {
      totals.set(s.id, input(discountOf(s)));
    } catch {
      totals.set(s.id, input({ type: "none" }));
    }
  }
  return totals;
}

function summaryOf(
  s: RecurringSchedule,
  client: Pick<Client, "name" | "recurringSendMode">,
  ws: Workspace,
  total: number,
): RecurringSummary {
  return {
    id: s.id,
    name: s.name,
    clientId: s.clientId,
    clientName: client.name,
    currency: s.currency,
    frequency: s.frequency,
    startDate: s.startDate,
    endDate: s.endDate,
    nextIssueDate: s.nextIssueDate,
    status: s.status,
    pausedReason: s.pausedReason,
    sendMode: s.sendMode,
    resolvedSendMode: resolveSendMode(s.sendMode, client.recurringSendMode, ws.recurringSendMode),
    total,
    lastPeriodId: s.lastPeriodId,
  };
}

/** The later of two ISO dates. */
function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** The status that fits a next issue date and an end date. Paused stays paused. */
function statusFor(
  current: RecurringSchedule["status"],
  nextIssueDate: string,
  endDate: string | null,
): RecurringSchedule["status"] {
  if (current === "paused") return "paused";
  return endDate && nextIssueDate > endDate ? "ended" : "active";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listSchedules(db: Db): Promise<RecurringSummary[]> {
  const ws = await loadWorkspace(db);
  const rows = await db
    .select({ schedule: recurringSchedules, client: clients })
    .from(recurringSchedules)
    .innerJoin(clients, eq(clients.id, recurringSchedules.clientId))
    .orderBy(asc(recurringSchedules.nextIssueDate), asc(clients.name))
    .limit(500);
  const schedules = rows.map((r) => r.schedule);
  const totals = await totalsOf(
    db,
    schedules,
    await scheduleLines(
      db,
      schedules.map((s) => s.id),
    ),
  );
  // Active schedules first, then paused, then ended.
  const order = { active: 0, paused: 1, ended: 2 } as const;
  return rows
    .map((r) => summaryOf(r.schedule, r.client, ws, totals.get(r.schedule.id) ?? 0))
    .sort((a, b) => order[a.status] - order[b.status]);
}

/** The active schedule with the earliest next issue date, for the dashboard. */
export async function nextActiveSchedule(db: Db): Promise<RecurringSummary | null> {
  const [row] = await db
    .select({ schedule: recurringSchedules, client: clients })
    .from(recurringSchedules)
    .innerJoin(clients, eq(clients.id, recurringSchedules.clientId))
    .where(eq(recurringSchedules.status, "active"))
    .orderBy(asc(recurringSchedules.nextIssueDate), asc(clients.name))
    .limit(1);
  if (!row) return null;
  const ws = await loadWorkspace(db);
  const totals = await totalsOf(db, [row.schedule], await scheduleLines(db, [row.schedule.id]));
  return summaryOf(row.schedule, row.client, ws, totals.get(row.schedule.id) ?? 0);
}

export async function getScheduleDetail(
  db: Db,
  id: string,
  opts: { now: number },
): Promise<RecurringDetail> {
  const ws = await loadWorkspace(db);
  const s = await loadSchedule(db, id);
  const client = await loadClient(db, s.clientId);
  const lines = await scheduleLines(db, [id]);
  const totals = await totalsOf(db, [s], lines);
  const today = workspaceToday(ws, opts.now);
  const invoiceRows = await db
    .select()
    .from(documents)
    .where(eq(documents.recurringScheduleId, id))
    .orderBy(desc(documents.issueDate), desc(documents.createdAt))
    .limit(50);
  return {
    ...summaryOf(s, client, ws, totals.get(id) ?? 0),
    sourceDocumentId: s.sourceDocumentId,
    paymentTermsDays: s.paymentTermsDays,
    discount: discountOf(s),
    notes: s.notes,
    footerText: s.footerText,
    templateId: s.templateId,
    lines: lines.map((l) => ({
      id: l.id,
      position: l.position,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRateId: l.taxRateId,
    })),
    upcoming:
      s.status === "active"
        ? upcomingDates({ ...ruleOf(s), endDate: s.endDate }, s.nextIssueDate, 3)
        : [],
    invoices: invoiceRows.map((doc) => ({
      id: doc.id,
      number: doc.number,
      status: doc.status,
      displayStatus: displayStatus(doc, today),
      issueDate: doc.issueDate,
      total: doc.total,
      periodId: doc.recurringPeriodId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Creates a schedule from an invoice. It copies the client, currency, lines, and terms. */
export async function createSchedule(
  db: Db,
  input: RecurringCreateInput,
  ctx: { actor: AuthUser; now: number },
): Promise<string> {
  const data = recurringCreateInput.parse(input);
  assertSendModeAllowed(ctx.actor, "inherit", data.sendMode);
  const [source] = await db.select().from(documents).where(eq(documents.id, data.sourceDocumentId));
  if (source?.kind !== "invoice") {
    throw new AppError(404, "document_not_found", "Choose an invoice to repeat");
  }
  const client = await loadClient(db, source.clientId);
  if (client.archivedAt !== null) {
    throw new AppError(409, "client_archived", "Restore the client before you make a schedule");
  }
  const lines = await db
    .select()
    .from(documentLines)
    .where(eq(documentLines.documentId, source.id))
    .orderBy(asc(documentLines.position));
  if (lines.length === 0) {
    throw new AppError(422, "no_lines", "Add at least one line to the invoice first");
  }

  const id = crypto.randomUUID();
  const rule: PeriodRule = {
    frequency: data.frequency,
    startDate: data.startDate,
    anchorDay: anchorDayOf(data.startDate),
  };
  const nextIssueDate = nextIssueDateFrom(rule, data.startDate, null);
  await db.batch([
    db.insert(recurringSchedules).values({
      id,
      clientId: source.clientId,
      sourceDocumentId: source.id,
      name: data.name,
      currency: source.currency,
      frequency: data.frequency,
      startDate: data.startDate,
      endDate: data.endDate,
      anchorDay: rule.anchorDay,
      nextIssueDate,
      sendMode: data.sendMode,
      status: statusFor("active", nextIssueDate, data.endDate),
      paymentTermsDays: source.paymentTermsDays,
      templateId: source.templateId,
      discountType: source.discountType,
      discountPercent: source.discountPercent,
      discountAmount: source.discountAmount,
      notes: source.notes,
      footerText: source.footerText,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }),
    db.insert(recurringScheduleLines).values(lineRows(id, lines)),
  ]);
  return id;
}

async function assertActiveTaxRates(db: Db, lines: LineInputData[], existing: Set<string>) {
  const ids = [...new Set(lines.map((l) => l.taxRateId).filter((v): v is string => !!v))];
  if (ids.length === 0) return;
  const rows = await db.select().from(taxRates).where(inArray(taxRates.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const rateId of ids) {
    const rate = byId.get(rateId);
    if (!rate || (rate.archivedAt !== null && !existing.has(rateId))) {
      throw new AppError(400, "invalid_tax_rate", "Choose an active tax rate for each line");
    }
  }
}

/**
 * Edits a schedule. A change to the frequency, start date, or end date moves the next
 * issue date to the first period from today that has no invoice yet.
 */
export async function updateSchedule(
  db: Db,
  id: string,
  data: RecurringUpdateData,
  ctx: { actor: AuthUser; now: number },
): Promise<void> {
  const s = await loadSchedule(db, id);
  assertSendModeAllowed(ctx.actor, s.sendMode, data.sendMode);
  const startDate = data.startDate ?? s.startDate;
  const endDate = data.endDate === undefined ? s.endDate : data.endDate;
  if (endDate && endDate < startDate) {
    throw new AppError(400, "invalid_end_date", "The end date must be on or after the start date");
  }
  if (data.templateId) {
    const [template] = await db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(eq(schema.templates.id, data.templateId));
    if (!template) throw new AppError(400, "invalid_template", "Choose an existing template");
  }
  if (data.lines) {
    const current = await scheduleLines(db, [id]);
    await assertActiveTaxRates(
      db,
      data.lines,
      new Set(current.map((l) => l.taxRateId).filter((v): v is string => !!v)),
    );
  }

  const timing =
    (data.frequency !== undefined && data.frequency !== s.frequency) ||
    startDate !== s.startDate ||
    endDate !== s.endDate;
  let nextIssueDate = s.nextIssueDate;
  const rule: PeriodRule = {
    frequency: data.frequency ?? s.frequency,
    startDate,
    anchorDay: anchorDayOf(startDate),
  };
  if (timing) {
    const ws = await loadWorkspace(db);
    const today = workspaceToday(ws, ctx.now);
    nextIssueDate = nextIssueDateFrom(rule, laterDate(startDate, today), s.lastPeriodId);
  }

  const statements: BatchStatement[] = [
    db
      .update(recurringSchedules)
      .set({
        name: data.name === undefined ? s.name : data.name,
        frequency: rule.frequency,
        startDate,
        endDate,
        anchorDay: rule.anchorDay,
        nextIssueDate,
        status: s.status === "paused" ? "paused" : statusFor(s.status, nextIssueDate, endDate),
        sendMode: data.sendMode ?? s.sendMode,
        paymentTermsDays:
          data.paymentTermsDays === undefined ? s.paymentTermsDays : data.paymentTermsDays,
        templateId: data.templateId === undefined ? s.templateId : data.templateId,
        ...(data.discount ? discountColumns(data.discount) : {}),
        notes: data.notes === undefined ? s.notes : data.notes,
        footerText: data.footerText === undefined ? s.footerText : data.footerText,
        updatedAt: ctx.now,
      })
      .where(eq(recurringSchedules.id, id)),
  ];
  if (data.lines) {
    statements.push(
      db.delete(recurringScheduleLines).where(eq(recurringScheduleLines.scheduleId, id)),
      db.insert(recurringScheduleLines).values(lineRows(id, data.lines)),
    );
  }
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}

export async function pauseSchedule(db: Db, id: string, now: number): Promise<void> {
  const s = await loadSchedule(db, id);
  if (s.status !== "active") return;
  await db
    .update(recurringSchedules)
    .set({ status: "paused", pausedReason: "manual", updatedAt: now })
    .where(and(eq(recurringSchedules.id, id), eq(recurringSchedules.status, "active")));
}

/**
 * Resumes a paused schedule. Periods missed while it was paused are skipped: the next
 * issue date is the first period from today that has no invoice yet.
 */
export async function resumeSchedule(db: Db, id: string, ctx: { now: number }): Promise<void> {
  const s = await loadSchedule(db, id);
  if (s.status !== "paused") return;
  const client = await loadClient(db, s.clientId);
  if (client.archivedAt !== null) {
    throw new AppError(
      409,
      "client_archived",
      "Restore the client before you resume this schedule",
    );
  }
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, ctx.now);
  const nextIssueDate = nextIssueDateFrom(ruleOf(s), laterDate(s.startDate, today), s.lastPeriodId);
  await db
    .update(recurringSchedules)
    .set({
      status: statusFor("active", nextIssueDate, s.endDate),
      pausedReason: null,
      nextIssueDate,
      updatedAt: ctx.now,
    })
    .where(and(eq(recurringSchedules.id, id), eq(recurringSchedules.status, "paused")));
}

/** Deletes a schedule and its lines. Invoices it created stay. */
export async function deleteSchedule(db: Db, id: string): Promise<void> {
  await loadSchedule(db, id);
  await db.batch([
    db.delete(recurringScheduleLines).where(eq(recurringScheduleLines.scheduleId, id)),
    db.delete(recurringSchedules).where(eq(recurringSchedules.id, id)),
  ]);
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * The enqueue hook: one job per due period of each active schedule, from the period
 * cursor up to today and the end date. The keys make repeated ticks a no-op. A schedule
 * whose next period is past its end date is marked ended.
 */
export async function recurringEnqueue(db: Db, today: string): Promise<EnqueueInput[]> {
  const due = await db
    .select()
    .from(recurringSchedules)
    .where(
      and(eq(recurringSchedules.status, "active"), lte(recurringSchedules.nextIssueDate, today)),
    )
    .orderBy(asc(recurringSchedules.nextIssueDate))
    .limit(HOOK_SCHEDULE_LIMIT);
  const inputs: EnqueueInput[] = [];
  const ended: string[] = [];
  for (const s of due) {
    const periods = duePeriods(
      { ...ruleOf(s), endDate: s.endDate },
      s.nextIssueDate,
      today,
      CATCH_UP_LIMIT,
    );
    if (periods.length === 0 && s.endDate && s.nextIssueDate > s.endDate) ended.push(s.id);
    for (const period of periods) {
      inputs.push({
        type: RECURRING_JOB,
        idempotencyKey: `recurring:${s.id}:${period.periodId}`,
        payload: { scheduleId: s.id, periodId: period.periodId, issueDate: period.issueDate },
      });
    }
  }
  if (ended.length) {
    await db
      .update(recurringSchedules)
      .set({ status: "ended" })
      .where(and(inArray(recurringSchedules.id, ended), eq(recurringSchedules.status, "active")));
  }
  return inputs;
}

/** Moves the period cursor past `issueDate`, and ends the schedule after its end date. */
function advanceCursor(db: Db, s: RecurringSchedule, payload: RecurringJobPayload, now: number) {
  const next = occurrenceAfter(ruleOf(s), payload.issueDate);
  const ended = s.endDate !== null && next > s.endDate;
  return db
    .update(recurringSchedules)
    .set({
      nextIssueDate: next,
      lastPeriodId: payload.periodId,
      ...(ended ? { status: "ended" as const } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(recurringSchedules.id, s.id),
        lte(recurringSchedules.nextIssueDate, payload.issueDate),
      ),
    );
}

async function ownerNotice(
  db: Db,
  docId: string,
  type: "recurring_draft_ready" | "fx_rate_needed",
  content: { subject: string; html: string; text: string },
  body: string | null,
  now: number,
): Promise<BatchStatement[]> {
  const to = await ownerEmails(db);
  const statements: BatchStatement[] = [
    db.insert(notifications).values({
      type,
      title: content.subject,
      body,
      documentId: docId,
      createdAt: now,
    }),
  ];
  if (to.length) {
    const payload: SendEmailJobPayload = {
      ...content,
      to,
      kind: "notification",
      documentId: docId,
    };
    statements.push(
      enqueueStatement(
        db,
        { type: SEND_EMAIL_JOB, idempotencyKey: `${type}:${docId}`, payload },
        now,
      ),
    );
  }
  return statements;
}

/** Finds the invoice of this period, or creates it as a draft. */
async function periodInvoice(
  db: Db,
  s: RecurringSchedule,
  client: Client,
  ws: Workspace,
  payload: RecurringJobPayload,
  now: number,
) {
  const existing = async () => {
    const [doc] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.recurringScheduleId, s.id),
          eq(documents.recurringPeriodId, payload.periodId),
        ),
      );
    return doc;
  };
  const found = await existing();
  if (found) return found;

  const lines = await scheduleLines(db, [s.id]);
  const data = documentCreateInput.parse({
    kind: "invoice",
    clientId: s.clientId,
    currency: s.currency,
    issueDate: payload.issueDate,
    // Due by terms: finalize adds the terms to the issue date.
    paymentTermsDays: s.paymentTermsDays ?? client.paymentTermsDays ?? ws.defaultPaymentTermsDays,
    discount: discountOf(s),
    notes: s.notes,
    footerText: s.footerText,
    templateId: s.templateId,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRateId: l.taxRateId,
    })),
  });
  try {
    await createDraft(
      db,
      data,
      { actor: null, now },
      {
        recurringScheduleId: s.id,
        recurringPeriodId: payload.periodId,
      },
    );
  } catch (err) {
    // A concurrent run created it first: the unique index rejects the second insert.
    const again = await existing();
    if (again) return again;
    throw err;
  }
  const created = await existing();
  if (!created) throw new Error("The recurring invoice was not created");
  return created;
}

/** Registers the enqueue hook and the job handler. Runs at import; tests call it after a reset. */
export function registerRecurringJobs(): void {
  registerEnqueueHook("recurring", ({ db, today }) => recurringEnqueue(db, today));

  registerJobHandler<RecurringJobPayload>(RECURRING_JOB, async ({ env, db, now, payload, job }) => {
    const [s] = await db
      .select()
      .from(recurringSchedules)
      .where(eq(recurringSchedules.id, payload.scheduleId));
    // Deleted, paused, or ended since the job was queued: nothing to create.
    if (s?.status !== "active") return undefined;
    if (s.endDate && payload.issueDate > s.endDate) return undefined;
    const client = await loadClient(db, s.clientId);
    if (client.archivedAt !== null) return undefined;
    const ws = await loadWorkspace(db);
    const mode = resolveSendMode(s.sendMode, client.recurringSendMode, ws.recurringSendMode);

    // Auto-send waits for email capacity before it creates anything (the daily cap).
    if (mode === "auto_send" && !(await hasEmailCapacity(db, ws, now))) {
      return { defer: { runAfter: nextEmailWindow(ws, now), reason: "daily_email_limit" } };
    }

    const doc = await periodInvoice(db, s, client, ws, payload, now);
    const cursor = advanceCursor(db, s, payload, now);
    const base = {
      workspace: ws.businessName || ws.name,
      accent: ws.accentColor,
      url: appDocumentUrl(env, "invoice", doc.id),
      clientName: client.name,
    };
    const draftReady = async (body: string | null) => ({
      statements: [
        cursor,
        ...(await ownerNotice(
          db,
          doc.id,
          "recurring_draft_ready",
          recurringDraftReadyEmail({ ...base, issueDate: payload.issueDate, scheduleName: s.name }),
          body,
          now,
        )),
      ],
    });

    if (mode === "draft") return draftReady(null);

    // Auto-send. A retry after a send never sends again.
    if (doc.status !== "draft" && doc.status !== "finalized") return { statements: [cursor] };
    try {
      await sendDocument(env, db, doc.id, {
        actor: null,
        now,
        trigger: "auto",
        idempotencyKey: `job:${job.id}`,
        fetcher: fxFetcher(),
      });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if (err.code === "daily_email_limit") {
        return { defer: { runAfter: nextEmailWindow(ws, now), reason: "daily_email_limit" } };
      }
      if (err.code === "fx_rate_required") {
        // The invoice stays a draft. The owner enters the rate and sends it (R20 edge case).
        return {
          statements: [
            cursor,
            ...(await ownerNotice(
              db,
              doc.id,
              "fx_rate_needed",
              fxRateNeededEmail({
                ...base,
                currency: s.currency,
                homeCurrency: ws.homeCurrency,
                date: payload.issueDate,
              }),
              err.message,
              now,
            )),
          ],
        };
      }
      if (err.code === "email_not_configured" || err.code === "no_recipients") {
        return draftReady(err.message);
      }
      throw err;
    }
    return { statements: [cursor] };
  });
}

registerRecurringJobs();
