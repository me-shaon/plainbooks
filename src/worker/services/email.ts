// Email delivery (U13): document sends through the mailswitch mailer, daily cap checks,
// the generic email job, and owner notifications.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Address, NotSentResult, SendResult, UnknownResult } from "mailswitch";
import type { EmailKind, Trigger } from "../../shared/domain";
import type { DocumentSnapshot, FxQuote, SendPreview } from "../../shared/schemas/document";
import { todayIn } from "../../shared/time";
import { type Db, schema } from "../db/client";
import type { Document, Workspace } from "../db/schema";
import { createAppMailer, emailCapacity, mailProviders } from "../email/mailer";
import type { ReadyEmailProvider } from "../email/settings";
import { documentEmail, quoteDecisionEmail } from "../email/templates";
import type { AuthUser, Bindings } from "../env";
import { AppError } from "../errors";
import { fxFetcher } from "../externals";
import { QUOTE_DECISION_JOB, type QuoteDecisionJobPayload } from "../routes/public";
import { activityInsert } from "./activity";
import {
  finalize,
  getRevision,
  loadDocument,
  loadWorkspace,
  markSent,
  workspaceToday,
} from "./documents";
import { type Fetcher, getRate } from "./fx";
import { type JobOutcome, registerJobHandler } from "./jobs";
import { counterName, formatDocumentNumber } from "./numbering";
import { getPdf } from "./pdf";

const { emailLog, clientContacts, users, notifications } = schema;

export const SEND_DOCUMENT_JOB = "send_document";
export const SEND_EMAIL_JOB = "send_email";
/** A job that meets a busy browser tries again after this long, without using an attempt. */
export const PDF_PENDING_RETRY_MS = 60_000;
/**
 * A job that finds every provider at its cap before it starts checks again after this
 * long. The cap check reads only counts, so it has no reset time.
 */
export const CAPACITY_RECHECK_MS = 60 * 60 * 1000;

/** The public origin for links in emails, without a trailing slash. */
export function appOrigin(env: Pick<Bindings, "APP_URL">): string {
  return (env.APP_URL ?? "").replace(/\/+$/, "");
}

/** The in-app link to a document. */
export function appDocumentUrl(env: Pick<Bindings, "APP_URL">, kind: string, id: string): string {
  return `${appOrigin(env)}/${kind === "quote" ? "quotes" : "invoices"}/${id}`;
}

/** `{ email: "billing@studio.example", name: "Studio One" }`. Throws 422 when no address is set. */
export function senderAddress(ws: Workspace): Address {
  const email = ws.emailFromAddress?.trim();
  if (!email) {
    throw new AppError(
      422,
      "email_not_configured",
      "Set the sender email in workspace settings before you send email",
    );
  }
  const name = (ws.emailFromName || ws.businessName || ws.name).replace(/["\\<>\r\n]/g, "").trim();
  return name ? { email, name } : { email };
}

export interface OutgoingEmail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  trigger?: Trigger;
  documentId?: string | null;
  revisionId?: string | null;
  reminderOffsetDays?: number | null;
  attachments?: { filename: string; content: Uint8Array }[];
  /** The mailswitch idempotency key. A retry with the same key never sends twice. */
  idempotencyKey?: string;
}

export interface DeliverOptions {
  now: number;
  /** The workspace row, when the caller already loaded it. */
  workspace?: Workspace;
  /** The providers, when the caller already loaded them. */
  providers?: readonly ReadyEmailProvider[];
}

export interface DeliveryOutcome {
  result: SendResult;
  logId: string;
}

/**
 * Sends one email through the mailer and writes an email_log row: `sent`, `failed` for
 * `not_sent`, or `unknown`. Never throws for provider errors. Throws 422
 * `email_not_configured` when the sender address or the primary provider is missing.
 */
export async function deliverEmail(
  env: Bindings,
  db: Db,
  email: OutgoingEmail,
  opts: DeliverOptions,
): Promise<DeliveryOutcome> {
  const ws = opts.workspace ?? (await loadWorkspace(db));
  const from = senderAddress(ws);
  const providers = opts.providers ?? (await mailProviders(env, db));
  const mailer = createAppMailer(env, db, providers, opts.now);
  const result = await mailer.send({
    from,
    to: email.to,
    ...(ws.replyToEmail ? { replyTo: ws.replyToEmail } : {}),
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(email.attachments?.length
      ? {
          attachments: email.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: "application/pdf",
          })),
        }
      : {}),
    ...(email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : {}),
  });

  const logId = crypto.randomUUID();
  const sent = result.status === "sent";
  await db.insert(emailLog).values({
    id: logId,
    day: todayIn(ws.timezone, opts.now),
    kind: email.kind,
    trigger: email.trigger ?? "manual",
    documentId: email.documentId ?? null,
    revisionId: email.revisionId ?? null,
    reminderOffsetDays: email.reminderOffsetDays ?? null,
    recipients: email.to,
    subject: email.subject,
    status: sent ? "sent" : result.status === "unknown" ? "unknown" : "failed",
    providerId: sent ? (result.providerMessageId ?? null) : null,
    emailProvider: result.provider ?? null,
    idempotencyKey: email.idempotencyKey ?? null,
    error: sent ? null : `${result.reason}: ${result.message}`.slice(0, 1000),
    createdAt: opts.now,
  });
  if (!sent) {
    console.error(
      "email send failed",
      JSON.stringify({ status: result.status, reason: result.reason, provider: result.provider }),
    );
  }
  return { result, logId };
}

// ---------------------------------------------------------------------------
// Send results
// ---------------------------------------------------------------------------

/** `not_sent` reasons that a later retry can fix. */
const RETRYABLE_REASONS: ReadonlySet<string> = new Set([
  "rate_limited",
  "daily_cap",
  "quota",
  "credits",
]);
/** `not_sent` reasons that mean the provider refused this email or these keys. */
const REJECTED_REASONS: ReadonlySet<string> = new Set([
  "auth",
  "rejected",
  "invalid_message",
  "unsupported",
]);

/** A send that ended `not_sent` or `unknown`. It keeps the mailswitch result for jobs. */
export class EmailSendError extends AppError {
  constructor(
    readonly result: NotSentResult | UnknownResult,
    /** What was sent, for the message: "The email" or "The reminder". */
    subject = "The email",
  ) {
    const [status, code, message] = describeFailure(result, subject);
    super(status, code, message);
    this.name = "EmailSendError";
  }
}

function describeFailure(
  result: NotSentResult | UnknownResult,
  subject: string,
): [422 | 429 | 502, string, string] {
  const detail = result.provider ? `${result.provider}: ${result.message}` : result.message;
  if (result.status === "unknown") {
    return [
      502,
      "email_needs_review",
      `${subject} may have gone out (${detail}). Check the email provider logs before you send it again.`,
    ];
  }
  if (result.reason === "daily_cap" || result.reason === "quota") {
    return [
      429,
      "daily_email_limit",
      `${subject} was not sent: every email provider reached its daily limit. Send again later, or download the PDF and mark the document as sent.`,
    ];
  }
  if (REJECTED_REASONS.has(result.reason)) {
    return [422, "email_rejected", `${subject} was not sent: ${detail}`];
  }
  return [502, "email_send_failed", `${subject} was not sent: ${detail}`];
}

/**
 * The job outcome for an email error, or null when the error is not about the send:
 * - `unknown`: needs review. The email may have gone out, so it is never retried.
 * - `not_sent` that a retry can fix: back to pending at `resetAt`, after `retryAfterMs`,
 *   or (with neither) a normal failed attempt with backoff.
 * - any other `not_sent`: the job fails now and the owner gets a notification.
 * - every provider at its cap before the send: back to pending after CAPACITY_RECHECK_MS.
 */
export function emailJobOutcome(err: unknown, now: number): JobOutcome | null {
  if (err instanceof EmailSendError) {
    const { result } = err;
    const detail = `${result.provider ?? "email"} ${result.status}/${result.reason}: ${result.message}`;
    if (result.status === "unknown") return { review: { message: detail } };
    if (RETRYABLE_REASONS.has(result.reason)) {
      if (result.resetAt !== undefined) {
        return { defer: { runAfter: Math.max(now, result.resetAt), reason: result.reason } };
      }
      if (result.retryAfterMs !== undefined) {
        return { defer: { runAfter: now + result.retryAfterMs, reason: result.reason } };
      }
      return null;
    }
    return { fail: { message: detail } };
  }
  if (err instanceof AppError && err.code === "daily_email_limit") {
    return { defer: { runAfter: now + CAPACITY_RECHECK_MS, reason: "daily_email_limit" } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Daily cap
// ---------------------------------------------------------------------------

/**
 * The providers with room under their daily cap, primary first. An empty list means every
 * provider is at its cap. Null means no provider is set up: the send then reports
 * `email_not_configured` itself.
 */
export async function providersWithCapacity(
  env: Bindings,
  db: Db,
  now: number,
): Promise<ReadyEmailProvider[] | null> {
  let providers: ReadyEmailProvider[];
  try {
    providers = await mailProviders(env, db);
  } catch (err) {
    if (err instanceof AppError && err.code === "email_not_configured") return null;
    throw err;
  }
  return (await emailCapacity(db, providers, now)).available;
}

/**
 * The providers with room under their daily cap, primary first. Throws 429
 * `daily_email_limit` when every provider is at its cap.
 */
export async function assertEmailCapacity(
  db: Db,
  providers: readonly ReadyEmailProvider[],
  now: number,
  subject = "The email",
): Promise<ReadyEmailProvider[]> {
  const { full, available } = await emailCapacity(db, providers, now);
  if (full) {
    throw new AppError(
      429,
      "daily_email_limit",
      `${subject} was not sent: every email provider reached its daily limit. Send again later, or download the PDF and mark the document as sent.`,
    );
  }
  return available;
}

/**
 * The key of a manual document send: `document:<id>:send:<n>`. `n` counts the document
 * emails that the provider accepted. A bounce or complaint still counts, because that
 * email went out. A `failed` send does not count, so the next try reuses its key. An
 * `unknown` send does not count either, so the key stays blocked until the Owner resolves
 * it, and a second click cannot send a duplicate. The count covers every revision, because
 * each revision has new email content and so needs a new key.
 */
export async function manualSendKey(db: Db, documentId: string): Promise<string> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.documentId, documentId),
        eq(emailLog.kind, "document"),
        inArray(emailLog.status, ["sent", "bounced", "complained"]),
      ),
    );
  return `document:${documentId}:send:${row?.count ?? 0}`;
}

// ---------------------------------------------------------------------------
// Document sends
// ---------------------------------------------------------------------------

/** The client's primary contact and billing contacts, primary first. */
export async function defaultRecipients(db: Db, clientId: string): Promise<string[]> {
  const rows = await db
    .select({ email: clientContacts.email, isPrimary: clientContacts.isPrimary })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clientId, clientId),
        or(eq(clientContacts.isPrimary, true), eq(clientContacts.isBilling, true)),
      ),
    );
  rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return [...new Set(rows.map((r) => r.email.trim().toLowerCase()))];
}

const SENDABLE: Record<string, readonly string[]> = {
  invoice: ["draft", "finalized", "sent", "partially_paid"],
  quote: ["draft", "sent"],
};

function assertSendable(doc: Document): void {
  if (doc.status === "void") throw new AppError(409, "document_void", "This invoice is void");
  if (!SENDABLE[doc.kind]?.includes(doc.status)) {
    throw new AppError(409, "send_not_allowed", "This document can no longer be sent");
  }
}

export interface SendDocumentOptions {
  actor?: AuthUser | null;
  /** Defaults to the client's primary and billing contacts. */
  recipients?: string[];
  subject?: string | null;
  message?: string | null;
  now: number;
  trigger?: Trigger;
  /** For the FX fetch at finalize. */
  fetcher?: Fetcher;
  idempotencyKey?: string;
  /** The longest wait for the browser lease. Defaults to 10 s. */
  pdfMaxWaitMs?: number;
  /**
   * The providers with room, when the caller already checked the caps (see
   * `providersWithCapacity`). The send then skips its own check.
   */
  providers?: readonly ReadyEmailProvider[];
}

export interface SendDocumentResult {
  document: Document;
  revisionId: string;
  /** The provider message ID, when the provider returns one. */
  emailId: string | null;
  recipients: string[];
}

/** Recipient display data from the snapshot, for the email body. */
function emailInput(
  env: Bindings,
  doc: Document,
  snapshot: DocumentSnapshot,
  ws: Workspace,
  opts: SendDocumentOptions,
) {
  const d = snapshot.document;
  return {
    kind: doc.kind,
    number: d.number ?? "",
    from: snapshot.brandKit.businessName || ws.name,
    clientName: snapshot.client.name,
    contactName: snapshot.client.contact?.name ?? null,
    currency: d.currency,
    total: snapshot.totals.total,
    balance: snapshot.totals.total - doc.amountPaid,
    dueDate: d.dueDate,
    expiryDate: d.expiryDate,
    publicUrl: `${appOrigin(env)}/p/${doc.publicToken}`,
    accent: snapshot.brandKit.accentColor,
    footer: snapshot.brandKit.footerText ?? null,
    message: opts.message,
    subject: opts.subject,
    revised: doc.kind === "invoice" && d.revisionNumber > 1,
  } as const;
}

/**
 * Sends a document: finalize (allocates the number once), ensure the PDF, send it through
 * the mailer, then mark sent only after a `sent` result. On a PDF or send failure the
 * document stays `finalized` with its number, an activity `send_failed` is written, and an
 * AppError is thrown: 503 pdf_pending, 502 pdf_render_failed, or an EmailSendError (422
 * email_rejected, 429 daily_email_limit, 502 email_send_failed, 502 email_needs_review).
 * Without a provider it throws 422 email_not_configured, and when every provider is at its
 * daily cap it throws 429 daily_email_limit, both before any number is used.
 *
 * A manual send uses the key from `manualSendKey`. A job passes `job:<id>`.
 */
export async function sendDocument(
  env: Bindings,
  db: Db,
  documentId: string,
  opts: SendDocumentOptions,
): Promise<SendDocumentResult> {
  const doc = await loadDocument(db, documentId);
  assertSendable(doc);
  const ws = await loadWorkspace(db);
  // Before finalize, so a missing sender or provider, or a full cap, never uses a number.
  senderAddress(ws);
  const providers =
    opts.providers ?? (await assertEmailCapacity(db, await mailProviders(env, db), opts.now));
  const recipients = opts.recipients?.length
    ? [...new Set(opts.recipients.map((r) => r.trim().toLowerCase()))]
    : await defaultRecipients(db, doc.clientId);
  if (recipients.length === 0) {
    throw new AppError(
      422,
      "no_recipients",
      "Add a recipient, or give the client a primary or billing contact",
    );
  }

  const finalized = await finalize(db, documentId, {
    now: opts.now,
    actor: opts.actor,
    fetcher: opts.fetcher ?? fxFetcher(env),
  });
  const current = finalized.document;
  const revisionId = current.currentRevisionId ?? finalized.revision.id;

  const fail = async (error: AppError): Promise<never> => {
    await activityInsert(db, {
      documentId,
      clientId: current.clientId,
      type: "send_failed",
      actorUserId: opts.actor?.id ?? null,
      data: { revisionId, code: error.code, message: error.message.slice(0, 500), recipients },
      now: opts.now,
    });
    throw error;
  };

  // Finalize already read the revision row. Reuse it for the PDF and the email body.
  const known =
    finalized.revision.id === revisionId
      ? (finalized.revision as Awaited<ReturnType<typeof getRevision>>)
      : undefined;
  const pdf = await getPdf(env, db, revisionId, {
    wait: true,
    maxWaitMs: opts.pdfMaxWaitMs,
    revision: known,
  });
  if (pdf.status === "pending") {
    return fail(
      new AppError(
        503,
        "pdf_pending",
        "The PDF is still being prepared. Try sending again shortly.",
      ),
    );
  }
  if (pdf.status === "failed") {
    return fail(
      new AppError(
        502,
        "pdf_render_failed",
        "The PDF could not be created, so the email was not sent. Try again.",
      ),
    );
  }

  const revision = known ?? (await getRevision(db, revisionId));
  const content = documentEmail(emailInput(env, current, revision.snapshot, ws, opts));
  // getPdf returns the R2 object of the revision (or the bytes it just stored there), so a
  // retry with the same key sends the same bytes.
  const { result } = await deliverEmail(
    env,
    db,
    {
      to: recipients,
      subject: content.subject,
      html: content.html,
      text: content.text,
      kind: "document",
      trigger: opts.trigger ?? "manual",
      documentId,
      revisionId,
      attachments: [{ filename: pdf.filename, content: pdf.bytes }],
      idempotencyKey: opts.idempotencyKey ?? (await manualSendKey(db, documentId)),
    },
    { now: opts.now, workspace: ws, providers },
  );
  if (result.status !== "sent") return fail(new EmailSendError(result));

  const document = await markSent(db, documentId, {
    revisionId,
    now: opts.now,
    actor: opts.actor,
    trigger: opts.trigger ?? "manual",
  });
  return { document, revisionId, emailId: result.providerMessageId ?? null, recipients };
}

/** The providers and their cap use, or null when no provider is set up. */
async function previewCapacity(env: Bindings, db: Db, now: number) {
  try {
    return await emailCapacity(db, await mailProviders(env, db), now, { totals: true });
  } catch (err) {
    if (err instanceof AppError && err.code === "email_not_configured") return null;
    throw err;
  }
}

/**
 * What the send dialog shows: default recipients and subject, the daily cap use, the
 * issue date, and the exchange rate the send would use. `revise` previews the subject of
 * the next revision ("Updated invoice"). It never allocates a number.
 */
export async function sendPreview(
  env: Bindings,
  db: Db,
  documentId: string,
  opts: { now: number; revise?: boolean; fetcher?: Fetcher },
): Promise<SendPreview> {
  const doc = await loadDocument(db, documentId);
  const ws = await loadWorkspace(db);
  const [recipients, capacity, counter] = await Promise.all([
    defaultRecipients(db, doc.clientId),
    previewCapacity(env, db, opts.now),
    doc.number
      ? Promise.resolve(null)
      : db
          .select({ value: schema.counters.value })
          .from(schema.counters)
          .where(eq(schema.counters.name, counterName(doc.kind))),
  ]);
  const prefix = doc.kind === "invoice" ? ws.invoicePrefix : ws.quotePrefix;
  const number =
    doc.number ?? formatDocumentNumber(prefix, ws.numberPadding, (counter?.[0]?.value ?? 0) + 1);
  const issueDate = doc.issueDate ?? workspaceToday(ws, opts.now);

  let fx: FxQuote | null = null;
  if (doc.currency !== ws.homeCurrency) {
    const locked = doc.number !== null || doc.status !== "draft";
    if ((doc.fxOverridden || locked) && doc.fxRate && doc.fxRateDate && doc.fxProvider) {
      fx = { status: "ok", rate: doc.fxRate, rateDate: doc.fxRateDate, provider: doc.fxProvider };
    } else {
      const result = await getRate(db, opts.fetcher ?? ((input, init) => fetch(input, init)), {
        from: doc.currency,
        to: ws.homeCurrency,
        date: issueDate,
        now: opts.now,
      });
      fx =
        result.status === "ok"
          ? {
              status: "ok",
              rate: result.rate,
              rateDate: result.rateDate,
              provider: result.provider,
            }
          : { status: "manual_required", message: result.message };
    }
  }

  const from = ws.businessName || ws.name;
  const content = documentEmail({
    kind: doc.kind,
    number,
    from,
    clientName: "",
    currency: doc.currency,
    total: doc.total,
    publicUrl: "",
    revised: doc.kind === "invoice" && (opts.revise === true || doc.revisionCount > 1),
  });
  return {
    recipients,
    subject: content.subject,
    emailConfigured: Boolean(ws.emailFromAddress?.trim()) && capacity !== null,
    emailsSentToday: capacity?.used ?? 0,
    dailyLimit: capacity?.limit ?? null,
    issueDate,
    homeCurrency: ws.homeCurrency,
    fx,
  };
}

/**
 * "Mark as sent" for manual delivery (a copied link or a downloaded PDF): finalize plus
 * markSent, without an email.
 */
export async function markSentManually(
  db: Db,
  documentId: string,
  opts: { actor?: AuthUser | null; now: number; fetcher?: Fetcher },
): Promise<{ document: Document; revisionId: string }> {
  assertSendable(await loadDocument(db, documentId));
  const finalized = await finalize(db, documentId, opts);
  const revisionId = finalized.document.currentRevisionId ?? finalized.revision.id;
  const document = await markSent(db, documentId, {
    revisionId,
    now: opts.now,
    actor: opts.actor,
    trigger: "manual",
  });
  return { document, revisionId };
}

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

export async function ownerEmails(db: Db): Promise<string[]> {
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.role, "owner"));
  return rows.map((r) => r.email);
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

/** Payload of `send_document` (scheduler auto-send, U15 and U16). */
export interface SendDocumentJobPayload {
  documentId: string;
  recipients?: string[];
  subject?: string | null;
  message?: string | null;
}

/** Payload of `send_email` (owner notifications and other plain emails). */
export interface SendEmailJobPayload {
  to: string[];
  subject: string;
  html: string;
  text: string;
  kind?: EmailKind;
  documentId?: string | null;
}

/**
 * The outcome of a job that sent one plain email. A retryable `not_sent` with no wait time
 * throws, so the job retries with backoff and then fails.
 */
export function sendJobOutcome(result: SendResult, now: number): JobOutcome {
  if (result.status === "sent") return undefined;
  const error = new EmailSendError(result);
  const outcome = emailJobOutcome(error, now);
  if (outcome) return outcome;
  throw error;
}

/** The browser is busy or rate limited. Try again soon without using an attempt. */
export const deferForPdf = (now: number) => ({
  defer: { runAfter: now + PDF_PENDING_RETRY_MS, reason: "pdf_pending" },
});

/** Registers the email job handlers. Runs at module scope; tests call it after a reset. */
export function registerEmailJobHandlers(): void {
  registerJobHandler<SendDocumentJobPayload>(
    SEND_DOCUMENT_JOB,
    async ({ env, db, now, payload, job }) => {
      try {
        await sendDocument(env, db, payload.documentId, {
          actor: null,
          recipients: payload.recipients,
          subject: payload.subject,
          message: payload.message,
          now,
          trigger: "auto",
          idempotencyKey: `job:${job.id}`,
        });
      } catch (err) {
        const outcome = emailJobOutcome(err, now);
        if (outcome) return outcome;
        if (err instanceof AppError) {
          if (err.code === "pdf_pending") return deferForPdf(now);
          // The document was voided, paid, or deleted since the job was queued. Nothing to send.
          if (
            err.status === 404 ||
            err.code === "send_not_allowed" ||
            err.code === "document_void"
          ) {
            console.log("send_document skipped", JSON.stringify({ jobId: job.id, code: err.code }));
            return undefined;
          }
        }
        throw err;
      }
      return undefined;
    },
    { heavy: true },
  );

  registerJobHandler<SendEmailJobPayload>(
    SEND_EMAIL_JOB,
    async ({ env, db, now, payload, job }) => {
      if (payload.to.length === 0) return undefined;
      const { result } = await deliverEmail(
        env,
        db,
        {
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          kind: payload.kind ?? "notification",
          trigger: "auto",
          documentId: payload.documentId ?? null,
          idempotencyKey: `job:${job.id}`,
        },
        { now },
      );
      return sendJobOutcome(result, now);
    },
  );

  /**
   * Quote decisions (R6): an in-app notification first, then one email to the sender and
   * every Owner. The notification does not wait for the email or the daily cap. Its ID is
   * the job ID, so a retried job does not add a second one.
   */
  registerJobHandler<QuoteDecisionJobPayload>(
    QUOTE_DECISION_JOB,
    async ({ env, db, now, payload, job }) => {
      const ws = await loadWorkspace(db);
      const doc = await loadDocument(db, payload.documentId);
      const [client] = await db
        .select({ name: schema.clients.name })
        .from(schema.clients)
        .where(eq(schema.clients.id, doc.clientId));
      const clientName = client?.name ?? "The client";
      const content = quoteDecisionEmail({
        workspace: ws.businessName || ws.name,
        accent: ws.accentColor,
        url: appDocumentUrl(env, "quote", doc.id),
        number: doc.number ?? "",
        clientName,
        decision: payload.decision,
        comment: doc.decisionComment,
      });
      await db
        .insert(notifications)
        .values({
          id: job.id,
          type: "quote_decision",
          title: content.subject,
          body: doc.decisionComment,
          documentId: doc.id,
          createdAt: now,
        })
        .onConflictDoNothing({ target: notifications.id });

      const ids = payload.recipientUserIds;
      const recipients = ids.length
        ? (await db.select({ email: users.email }).from(users).where(inArray(users.id, ids))).map(
            (r) => r.email,
          )
        : await ownerEmails(db);
      if (recipients.length === 0) return undefined;
      const { result } = await deliverEmail(
        env,
        db,
        {
          to: [...new Set(recipients)],
          subject: content.subject,
          html: content.html,
          text: content.text,
          kind: "notification",
          trigger: "auto",
          documentId: doc.id,
          idempotencyKey: `job:${job.id}`,
        },
        { now, workspace: ws },
      );
      return sendJobOutcome(result, now);
    },
    { heavy: true },
  );
}

registerEmailJobHandlers();
