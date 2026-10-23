// Payment reminders (U16): mode precedence, the workspace step schedule, the overdue cap,
// suggestions for the dashboard, manual sends, and the auto-send job.
//
// A reminder is an email_log row with kind "reminder" that Resend accepted (any status but
// "failed"). Its reminder_offset_days is the day of the send relative to the due date, so
// manual and automatic reminders count the same way:
// - a step is done when a reminder went out on or after the step's day;
// - the overdue cap counts reminders with an offset above 0 (R53). The before-due and
//   due-date steps are outside the cap.
// Email choice: the reminder links to the public page, and attaches the PDF only when the
// current revision's PDF is already in R2. A reminder never waits for a browser render.
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { ReminderMode, ReminderModeSetting } from "../../shared/domain";
import { displayStatus } from "../../shared/schemas/document";
import type { ReminderStatus, ReminderSuggestion } from "../../shared/schemas/reminder";
import { todayIn } from "../../shared/time";
import { type Db, schema } from "../db/client";
import type { Document, Workspace } from "../db/schema";
import { reminderEmail } from "../email/templates";
import type { AuthUser, Bindings } from "../env";
import { AppError } from "../errors";
import { activityInsert } from "./activity";
import {
  assertReminderModeAllowed,
  getRevision,
  loadDocument,
  loadWorkspace,
  workspaceToday,
} from "./documents";
import {
  appOrigin,
  DAILY_EMAIL_LIMIT,
  defaultRecipients,
  deliverEmail,
  hasEmailCapacity,
  nextEmailWindow,
} from "./email";
import { registerEnqueueHook, registerJobHandler } from "./jobs";
import { pdfFilename, pdfKey } from "./pdf";

const { documents, clients, emailLog } = schema;

export const REMINDER_JOB = "send_reminder";
/** Open invoices the enqueue hook and the suggestions read at most. */
const CANDIDATE_LIMIT = 500;
const OPEN = ["sent", "partially_paid"] as const;

export interface ReminderJobPayload {
  documentId: string;
  /** The schedule step that was due when the job was queued. */
  step: number;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * R53: "off" on the invoice or the client always wins. Otherwise the invoice setting
 * overrides the client setting, which overrides the workspace default.
 */
export function resolveMode(
  invoice: ReminderModeSetting,
  client: ReminderModeSetting,
  workspace: ReminderMode,
): ReminderMode {
  if (invoice === "off" || client === "off") return "off";
  if (invoice !== "inherit") return invoice;
  if (client !== "inherit") return client;
  return workspace;
}

/** Whole days from `from` to `to` (ISO dates). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface StepInput {
  /** Today relative to the due date. */
  offsetDays: number;
  /** Step offsets from the workspace schedule. */
  steps: number[];
  /** The latest reminder's offset, or null when none was sent. */
  lastSentOffset: number | null;
  /** The day of the first send relative to the due date. Steps on or before it are skipped. */
  sentOffset: number | null;
  overdueSent: number;
  cap: number;
}

/**
 * The step that is due today, or null. Only the latest step that has started counts: a
 * missed earlier step is not sent late. A step is done when a reminder (manual or
 * automatic) went out on or after its day.
 */
export function dueStep(input: StepInput): number | null {
  const started = input.steps.filter((s) => s <= input.offsetDays);
  if (started.length === 0) return null;
  const step = Math.max(...started);
  if (input.sentOffset !== null && step <= input.sentOffset) return null;
  if (input.lastSentOffset !== null && input.lastSentOffset >= step) return null;
  if (step > 0 && input.overdueSent >= input.cap) return null;
  return step;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface Candidate {
  doc: Document;
  clientName: string;
  clientMode: ReminderModeSetting;
  mode: ReminderMode;
  offsetDays: number;
  lastSentOffset: number | null;
  lastReminderAt: number | null;
  overdueSent: number;
  step: number | null;
}

function isOpen(doc: Pick<Document, "kind" | "status" | "dueDate" | "total" | "amountPaid">) {
  return (
    doc.kind === "invoice" &&
    (OPEN as readonly string[]).includes(doc.status) &&
    doc.dueDate !== null &&
    doc.total - doc.amountPaid > 0
  );
}

/** Reminder counts per document, from accepted reminder emails. */
async function reminderStats(db: Db, ids: string[]) {
  const stats = new Map<string, { last: number | null; lastAt: number | null; overdue: number }>();
  if (ids.length === 0) return stats;
  const rows = await db
    .select({
      documentId: emailLog.documentId,
      last: sql<number | null>`max(${emailLog.reminderOffsetDays})`,
      lastAt: sql<number | null>`max(${emailLog.createdAt})`,
      overdue: sql<number>`sum(case when ${emailLog.reminderOffsetDays} > 0 then 1 else 0 end)`,
    })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.kind, "reminder"),
        ne(emailLog.status, "failed"),
        inArray(emailLog.documentId, ids),
      ),
    )
    .groupBy(emailLog.documentId);
  for (const row of rows) {
    if (row.documentId) {
      stats.set(row.documentId, { last: row.last, lastAt: row.lastAt, overdue: row.overdue ?? 0 });
    }
  }
  return stats;
}

async function loadCandidates(
  db: Db,
  ws: Workspace,
  now: number,
  documentIds?: string[],
): Promise<Candidate[]> {
  const today = workspaceToday(ws, now);
  const rows = await db
    .select({ doc: documents, clientName: clients.name, clientMode: clients.reminderMode })
    .from(documents)
    .innerJoin(clients, eq(clients.id, documents.clientId))
    .where(
      and(
        eq(documents.kind, "invoice"),
        inArray(documents.status, [...OPEN]),
        sql`${documents.dueDate} IS NOT NULL`,
        gt(sql`${documents.total} - ${documents.amountPaid}`, 0),
        documentIds ? inArray(documents.id, documentIds) : undefined,
      ),
    )
    .orderBy(documents.dueDate)
    .limit(CANDIDATE_LIMIT);
  const stats = await reminderStats(
    db,
    rows.map((r) => r.doc.id),
  );
  const steps = ws.reminderSchedule.map((s) => s.offsetDays);
  return rows.map(({ doc, clientName, clientMode }) => {
    const dueDate = doc.dueDate as string;
    const offsetDays = daysBetween(dueDate, today);
    const stat = stats.get(doc.id);
    const mode = resolveMode(doc.reminderMode, clientMode, ws.reminderMode);
    const sentOffset = doc.sentAt ? daysBetween(dueDate, todayIn(ws.timezone, doc.sentAt)) : null;
    const overdueSent = stat?.overdue ?? 0;
    const step =
      mode === "off"
        ? null
        : dueStep({
            offsetDays,
            steps,
            lastSentOffset: stat?.last ?? null,
            sentOffset,
            overdueSent,
            cap: ws.overdueReminderCap,
          });
    return {
      doc,
      clientName,
      clientMode,
      mode,
      offsetDays,
      lastSentOffset: stat?.last ?? null,
      lastReminderAt: stat?.lastAt ?? null,
      overdueSent,
      step,
    };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The "needs reminder" list: open invoices (sent, partially paid, or overdue) in suggest
 * mode whose current step is due and that are under the overdue cap. "off" never shows.
 */
export async function listSuggestions(db: Db, now: number): Promise<ReminderSuggestion[]> {
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, now);
  const candidates = await loadCandidates(db, ws, now);
  return candidates
    .filter((c) => c.mode === "suggest" && c.step !== null)
    .sort((a, b) => b.offsetDays - a.offsetDays)
    .map((c) => ({
      documentId: c.doc.id,
      number: c.doc.number,
      clientId: c.doc.clientId,
      clientName: c.clientName,
      currency: c.doc.currency,
      total: c.doc.total,
      balance: c.doc.total - c.doc.amountPaid,
      dueDate: c.doc.dueDate as string,
      displayStatus: displayStatus(c.doc, today),
      offsetDays: c.offsetDays,
      stepOffsetDays: c.step as number,
      overdueSent: c.overdueSent,
      overdueCap: ws.overdueReminderCap,
      lastReminderAt: c.lastReminderAt,
    }));
}

function blockedReason(c: Candidate | undefined, cap: number): string | null {
  if (!c) return "Reminders go only to sent invoices with an open balance.";
  if (c.mode === "off") return "Reminders are off for this invoice or its client.";
  if (c.offsetDays > 0 && c.overdueSent >= cap) {
    return `This invoice already got ${cap} overdue reminders, the limit.`;
  }
  return null;
}

/** The reminder panel on the invoice page. */
export async function reminderStatus(
  db: Db,
  documentId: string,
  now: number,
): Promise<ReminderStatus> {
  const ws = await loadWorkspace(db);
  const doc = await loadDocument(db, documentId);
  if (doc.kind !== "invoice") {
    throw new AppError(404, "document_not_found", "Reminders apply to invoices only");
  }
  const [client] = await db
    .select({ mode: clients.reminderMode })
    .from(clients)
    .where(eq(clients.id, doc.clientId));
  const clientMode = client?.mode ?? "inherit";
  const [candidate] = isOpen(doc) ? await loadCandidates(db, ws, now, [doc.id]) : [];
  const history = await db
    .select({
      at: emailLog.createdAt,
      offsetDays: emailLog.reminderOffsetDays,
      trigger: emailLog.trigger,
      status: emailLog.status,
    })
    .from(emailLog)
    .where(and(eq(emailLog.documentId, doc.id), eq(emailLog.kind, "reminder")))
    .orderBy(desc(emailLog.createdAt))
    .limit(50);
  const reason = blockedReason(candidate, ws.overdueReminderCap);
  return {
    invoiceMode: doc.reminderMode,
    clientMode,
    workspaceMode: ws.reminderMode,
    mode: resolveMode(doc.reminderMode, clientMode, ws.reminderMode),
    offsetDays: doc.dueDate ? daysBetween(doc.dueDate, workspaceToday(ws, now)) : null,
    dueStep: candidate?.step ?? null,
    overdueSent:
      candidate?.overdueSent ??
      history.filter((h) => h.status !== "failed" && (h.offsetDays ?? 0) > 0).length,
    overdueCap: ws.overdueReminderCap,
    canSend: reason === null,
    blockedReason: reason,
    history,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Sets the reminder mode of an invoice, including a sent one. Auto-send is Owner only. */
export async function setReminderMode(
  db: Db,
  documentId: string,
  mode: ReminderModeSetting,
  ctx: { actor: AuthUser; now: number },
): Promise<void> {
  const doc = await loadDocument(db, documentId);
  if (doc.kind !== "invoice") {
    throw new AppError(409, "invalid_kind", "Reminders apply to invoices only");
  }
  assertReminderModeAllowed(ctx.actor, doc.reminderMode, mode);
  if (mode === doc.reminderMode) return;
  await db.batch([
    db
      .update(documents)
      .set({ reminderMode: mode, updatedAt: ctx.now })
      .where(eq(documents.id, documentId)),
    activityInsert(db, {
      documentId,
      clientId: doc.clientId,
      type: "updated",
      actorUserId: ctx.actor.id,
      data: { reminderMode: mode },
      now: ctx.now,
    }),
  ]);
}

export interface SendReminderOptions {
  actor?: AuthUser | null;
  now: number;
  trigger: "manual" | "auto";
  idempotencyKey?: string;
}

/**
 * Sends one reminder with the reminder template, logs it (email_log kind "reminder" and
 * activity "reminder_sent"), and returns the offset it counted at. Throws 409
 * reminders_off, 409 reminder_cap_reached, 409 not_open, 429 daily_email_limit,
 * 422 no_recipients, 422 email_rejected, or 502 email_send_failed.
 */
export async function sendReminder(
  env: Bindings,
  db: Db,
  documentId: string,
  opts: SendReminderOptions,
): Promise<{ offsetDays: number; recipients: string[] }> {
  const ws = await loadWorkspace(db);
  const doc = await loadDocument(db, documentId);
  if (!isOpen(doc) || !doc.currentRevisionId) {
    throw new AppError(409, "not_open", "Reminders go only to sent invoices with an open balance");
  }
  const [candidate] = await loadCandidates(db, ws, opts.now, [doc.id]);
  const reason = blockedReason(candidate, ws.overdueReminderCap);
  if (!candidate || reason) {
    throw new AppError(
      409,
      candidate?.mode === "off" ? "reminders_off" : "reminder_cap_reached",
      reason ?? "This invoice cannot get a reminder",
    );
  }
  if (!(await hasEmailCapacity(db, ws, opts.now))) {
    throw new AppError(
      429,
      "daily_email_limit",
      `The app sent ${DAILY_EMAIL_LIMIT} emails today, the daily limit. Send the reminder tomorrow.`,
    );
  }
  const recipients = await defaultRecipients(db, doc.clientId);
  if (recipients.length === 0) {
    throw new AppError(422, "no_recipients", "Give the client a primary or billing contact");
  }

  const revision = await getRevision(db, doc.currentRevisionId);
  const snapshot = revision.snapshot;
  const content = reminderEmail({
    kind: "invoice",
    number: doc.number ?? "",
    from: snapshot.brandKit.businessName || ws.name,
    clientName: snapshot.client.name,
    contactName: snapshot.client.contact?.name ?? null,
    currency: doc.currency,
    total: doc.total,
    balance: doc.total - doc.amountPaid,
    dueDate: doc.dueDate,
    publicUrl: `${appOrigin(env)}/p/${doc.publicToken}`,
    accent: snapshot.brandKit.accentColor,
    footer: snapshot.brandKit.footerText ?? null,
    offsetDays: candidate.offsetDays,
  });
  // Attach the PDF only when it is already cached. Otherwise the link is enough.
  const cached = await env.BUCKET.get(pdfKey(revision.id));
  const attachments = cached
    ? [{ filename: pdfFilename(snapshot), content: new Uint8Array(await cached.arrayBuffer()) }]
    : undefined;

  const outcome = await deliverEmail(
    env,
    db,
    {
      to: recipients,
      subject: content.subject,
      html: content.html,
      text: content.text,
      kind: "reminder",
      trigger: opts.trigger,
      documentId,
      revisionId: revision.id,
      reminderOffsetDays: candidate.offsetDays,
      attachments,
      idempotencyKey: opts.idempotencyKey,
    },
    opts.now,
  );
  if (!outcome.ok) {
    const rejected = outcome.status >= 400 && outcome.status < 500 && outcome.status !== 429;
    throw new AppError(
      rejected ? 422 : 502,
      rejected ? "email_rejected" : "email_send_failed",
      `The reminder was not sent: ${outcome.message}`,
    );
  }
  await activityInsert(db, {
    documentId,
    clientId: doc.clientId,
    type: "reminder_sent",
    actorUserId: opts.actor?.id ?? null,
    data: { offsetDays: candidate.offsetDays, trigger: opts.trigger, recipients },
    now: opts.now,
  });
  return { offsetDays: candidate.offsetDays, recipients };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/** Jobs for open invoices in auto-send mode whose current step is due. */
export async function reminderEnqueue(db: Db, ws: Workspace, now: number) {
  const candidates = await loadCandidates(db, ws, now);
  return candidates
    .filter((c) => c.mode === "auto_send" && c.step !== null)
    .map((c) => ({
      type: REMINDER_JOB,
      idempotencyKey: `reminder:${c.doc.id}:${c.step}`,
      payload: { documentId: c.doc.id, step: c.step as number } satisfies ReminderJobPayload,
    }));
}

const SKIP_CODES = new Set([
  "not_open",
  "reminders_off",
  "reminder_cap_reached",
  "no_recipients",
  "email_not_configured",
  "document_not_found",
]);

/** Registers the enqueue hook and the job handler. Runs at import; tests call it after a reset. */
export function registerReminderJobs(): void {
  registerEnqueueHook("reminders", ({ db, workspace, now }) => reminderEnqueue(db, workspace, now));

  registerJobHandler<ReminderJobPayload>(REMINDER_JOB, async ({ env, db, now, payload, job }) => {
    const ws = await loadWorkspace(db);
    const [candidate] = await loadCandidates(db, ws, now, [payload.documentId]);
    // Paid, voided, switched off, or reminded by hand since the job was queued.
    if (candidate?.mode !== "auto_send" || candidate.step === null) return undefined;
    if (!(await hasEmailCapacity(db, ws, now))) {
      return { defer: { runAfter: nextEmailWindow(ws, now), reason: "daily_email_limit" } };
    }
    try {
      await sendReminder(env, db, payload.documentId, {
        actor: null,
        now,
        trigger: "auto",
        idempotencyKey: `job:${job.id}`,
      });
    } catch (err) {
      if (err instanceof AppError) {
        if (err.code === "daily_email_limit") {
          return { defer: { runAfter: nextEmailWindow(ws, now), reason: "daily_email_limit" } };
        }
        if (SKIP_CODES.has(err.code)) {
          console.log("send_reminder skipped", JSON.stringify({ jobId: job.id, code: err.code }));
          return undefined;
        }
      }
      throw err;
    }
    return undefined;
  });
}

registerReminderJobs();
