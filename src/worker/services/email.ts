// Email delivery (U13): document sends through the Resend REST API, the daily cap, the
// generic email job, and owner notifications.
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { EmailKind, Trigger } from "../../shared/domain";
import type { DocumentSnapshot, FxQuote, SendPreview } from "../../shared/schemas/document";
import { DAILY_EMAIL_LIMIT } from "../../shared/schemas/email";
import { addDays, todayIn, zonedTime } from "../../shared/time";
import { type Db, schema } from "../db/client";
import type { Document, Workspace } from "../db/schema";
import { documentEmail, quoteDecisionEmail } from "../email/templates";
import type { AuthUser, Bindings } from "../env";
import { AppError } from "../errors";
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
import { registerJobHandler } from "./jobs";
import { counterName, formatDocumentNumber } from "./numbering";
import { getPdf } from "./pdf";

const { emailLog, clientContacts, users, notifications } = schema;

export { DAILY_EMAIL_LIMIT };
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const SEND_DOCUMENT_JOB = "send_document";
export const SEND_EMAIL_JOB = "send_email";

// ---------------------------------------------------------------------------
// Resend transport
// ---------------------------------------------------------------------------

export type ResendFetch = (url: string, init: RequestInit) => Promise<Response>;

let testFetch: ResendFetch | null = null;

/** Tests only: replaces the fetch used for Resend. Pass null to restore it. */
export function setResendFetchForTesting(fetcher: ResendFetch | null): void {
  testFetch = fetcher;
}

function resendFetch(): ResendFetch {
  return testFetch ?? ((url, init) => fetch(url, init));
}

/** The public origin for links in emails, without a trailing slash. */
export function appOrigin(env: Pick<Bindings, "APP_URL">): string {
  return (env.APP_URL ?? "").replace(/\/+$/, "");
}

/** The in-app link to a document. */
export function appDocumentUrl(env: Pick<Bindings, "APP_URL">, kind: string, id: string): string {
  return `${appOrigin(env)}/${kind === "quote" ? "quotes" : "invoices"}/${id}`;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** `"Studio One" <billing@studio.example>`. Throws 422 when no sender address is set. */
export function fromHeader(ws: Workspace): string {
  const address = ws.emailFromAddress?.trim();
  if (!address) {
    throw new AppError(
      422,
      "email_not_configured",
      "Set the sender email in workspace settings before you send email",
    );
  }
  const name = (ws.emailFromName || ws.businessName || ws.name).replace(/["\\<>\r\n]/g, "").trim();
  return name ? `"${name}" <${address}>` : address;
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
  /** Sent as Resend's Idempotency-Key, so a retried job never sends twice. */
  idempotencyKey?: string;
}

export type DeliveryOutcome =
  | { ok: true; providerId: string; logId: string }
  | { ok: false; status: number; message: string; logId: string };

/**
 * POSTs one email to Resend and writes an email_log row (sent or failed). Never throws for
 * provider errors. Throws 422 `email_not_configured` when the sender or API key is missing.
 */
export async function deliverEmail(
  env: Bindings,
  db: Db,
  email: OutgoingEmail,
  now: number,
): Promise<DeliveryOutcome> {
  const ws = await loadWorkspace(db);
  const from = fromHeader(ws);
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new AppError(422, "email_not_configured", "The Resend API key is not set");
  }
  const body: Record<string, unknown> = {
    from,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
  if (ws.replyToEmail) body.reply_to = ws.replyToEmail;
  if (email.attachments?.length) {
    body.attachments = email.attachments.map((a) => ({
      filename: a.filename,
      content: base64(a.content),
    }));
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (email.idempotencyKey) headers["Idempotency-Key"] = email.idempotencyKey.slice(0, 256);

  let status = 0;
  let providerId: string | null = null;
  let message = "";
  try {
    const res = await resendFetch()(RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    status = res.status;
    const json = (await res.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;
    if (res.ok && json?.id) providerId = json.id;
    else message = json?.message || `Resend returned HTTP ${res.status}`;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }

  const logId = crypto.randomUUID();
  await db.insert(emailLog).values({
    id: logId,
    day: todayIn(ws.timezone, now),
    kind: email.kind,
    trigger: email.trigger ?? "manual",
    documentId: email.documentId ?? null,
    revisionId: email.revisionId ?? null,
    reminderOffsetDays: email.reminderOffsetDays ?? null,
    recipients: email.to,
    subject: email.subject,
    status: providerId ? "sent" : "failed",
    providerId,
    error: providerId ? null : message.slice(0, 1000),
    createdAt: now,
  });
  if (providerId) return { ok: true, providerId, logId };
  console.error("resend send failed", JSON.stringify({ status, message }));
  return { ok: false, status, message, logId };
}

// ---------------------------------------------------------------------------
// Daily cap
// ---------------------------------------------------------------------------

/** Emails Resend accepted today (workspace day). Failed attempts do not count. */
export async function emailsSentToday(db: Db, ws: Workspace, now: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailLog)
    .where(and(eq(emailLog.day, todayIn(ws.timezone, now)), ne(emailLog.status, "failed")));
  return row?.count ?? 0;
}

/** 00:05 tomorrow in the workspace timezone, when the daily count starts again. */
export function nextEmailWindow(ws: Pick<Workspace, "timezone">, now: number): number {
  return zonedTime(ws.timezone, addDays(todayIn(ws.timezone, now), 1), 0, 5);
}

export async function hasEmailCapacity(db: Db, ws: Workspace, now: number): Promise<boolean> {
  return (await emailsSentToday(db, ws, now)) < DAILY_EMAIL_LIMIT;
}

async function assertEmailCapacity(db: Db, ws: Workspace, now: number): Promise<void> {
  if (!(await hasEmailCapacity(db, ws, now))) {
    throw new AppError(
      429,
      "daily_email_limit",
      `The app sent ${DAILY_EMAIL_LIMIT} emails today, the daily limit. Send again tomorrow, or download the PDF and mark the document as sent.`,
    );
  }
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
}

export interface SendDocumentResult {
  document: Document;
  revisionId: string;
  emailId: string;
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
 * Sends a document: finalize (allocates the number once), ensure the PDF, POST to Resend,
 * then mark sent only after a 2xx. On a PDF or Resend failure the document stays
 * `finalized` with its number, an activity `send_failed` is written, and an AppError is
 * thrown: 503 pdf_pending, 502 pdf_render_failed, 422 email_rejected, 502 email_send_failed.
 * At the daily cap it throws 429 daily_email_limit before any number is used.
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
  fromHeader(ws);
  await assertEmailCapacity(db, ws, opts.now);
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
    fetcher: opts.fetcher,
  });
  const current = finalized.document;
  const revisionId = current.currentRevisionId ?? finalized.revision.id;

  const fail = async (status: 422 | 502 | 503, code: string, message: string): Promise<never> => {
    await activityInsert(db, {
      documentId,
      clientId: current.clientId,
      type: "send_failed",
      actorUserId: opts.actor?.id ?? null,
      data: { revisionId, code, message: message.slice(0, 500), recipients },
      now: opts.now,
    });
    throw new AppError(status, code, message);
  };

  const pdf = await getPdf(env, db, revisionId, { wait: true, maxWaitMs: opts.pdfMaxWaitMs });
  if (pdf.status === "pending") {
    return fail(503, "pdf_pending", "The PDF is still being prepared. Try sending again shortly.");
  }
  if (pdf.status === "failed") {
    return fail(
      502,
      "pdf_render_failed",
      "The PDF could not be created, so the email was not sent. Try again.",
    );
  }

  const revision = await getRevision(db, revisionId);
  const content = documentEmail(emailInput(env, current, revision.snapshot, ws, opts));
  const outcome = await deliverEmail(
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
      idempotencyKey: opts.idempotencyKey,
    },
    opts.now,
  );
  if (!outcome.ok) {
    const rejected = outcome.status >= 400 && outcome.status < 500 && outcome.status !== 429;
    return fail(
      rejected ? 422 : 502,
      rejected ? "email_rejected" : "email_send_failed",
      `The email was not sent: ${outcome.message}`,
    );
  }

  const document = await markSent(db, documentId, {
    revisionId,
    now: opts.now,
    actor: opts.actor,
    trigger: opts.trigger ?? "manual",
  });
  return { document, revisionId, emailId: outcome.providerId, recipients };
}

/**
 * What the send dialog shows: default recipients and subject, the daily email count, the
 * issue date, and the exchange rate the send would use. `revise` previews the subject of
 * the next revision ("Updated invoice"). It never allocates a number.
 */
export async function sendPreview(
  db: Db,
  documentId: string,
  opts: { now: number; revise?: boolean; fetcher?: Fetcher },
): Promise<SendPreview> {
  const doc = await loadDocument(db, documentId);
  const ws = await loadWorkspace(db);
  const [recipients, sentToday, counter] = await Promise.all([
    defaultRecipients(db, doc.clientId),
    emailsSentToday(db, ws, opts.now),
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
    emailConfigured: Boolean(ws.emailFromAddress?.trim()),
    emailsSentToday: sentToday,
    dailyLimit: DAILY_EMAIL_LIMIT,
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

const deferToTomorrow = (ws: Workspace, now: number) => ({
  defer: { runAfter: nextEmailWindow(ws, now), reason: "daily_email_limit" },
});

/** Registers the email job handlers. Runs at module scope; tests call it after a reset. */
export function registerEmailJobHandlers(): void {
  registerJobHandler<SendDocumentJobPayload>(
    SEND_DOCUMENT_JOB,
    async ({ env, db, now, payload, job }) => {
      const ws = await loadWorkspace(db);
      if (!(await hasEmailCapacity(db, ws, now))) return deferToTomorrow(ws, now);
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
        if (err instanceof AppError) {
          if (err.code === "daily_email_limit") return deferToTomorrow(ws, now);
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
  );

  registerJobHandler<SendEmailJobPayload>(
    SEND_EMAIL_JOB,
    async ({ env, db, now, payload, job }) => {
      if (payload.to.length === 0) return undefined;
      const ws = await loadWorkspace(db);
      if (!(await hasEmailCapacity(db, ws, now))) return deferToTomorrow(ws, now);
      const outcome = await deliverEmail(
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
        now,
      );
      if (!outcome.ok) throw new Error(`Resend HTTP ${outcome.status}: ${outcome.message}`);
      return undefined;
    },
  );

  /**
   * Quote decisions (R6): one email to the sender and every Owner, plus an in-app
   * notification row that commits with the job's done marker.
   */
  registerJobHandler<QuoteDecisionJobPayload>(
    QUOTE_DECISION_JOB,
    async ({ env, db, now, payload, job }) => {
      const ws = await loadWorkspace(db);
      if (!(await hasEmailCapacity(db, ws, now))) return deferToTomorrow(ws, now);
      const doc = await loadDocument(db, payload.documentId);
      const [client] = await db
        .select({ name: schema.clients.name })
        .from(schema.clients)
        .where(eq(schema.clients.id, doc.clientId));
      const clientName = client?.name ?? "The client";
      const ids = payload.recipientUserIds;
      const recipients = ids.length
        ? (await db.select({ email: users.email }).from(users).where(inArray(users.id, ids))).map(
            (r) => r.email,
          )
        : await ownerEmails(db);
      const content = quoteDecisionEmail({
        workspace: ws.businessName || ws.name,
        accent: ws.accentColor,
        url: appDocumentUrl(env, "quote", doc.id),
        number: doc.number ?? "",
        clientName,
        decision: payload.decision,
        comment: doc.decisionComment,
      });
      if (recipients.length) {
        const outcome = await deliverEmail(
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
          now,
        );
        if (!outcome.ok) throw new Error(`Resend HTTP ${outcome.status}: ${outcome.message}`);
      }
      return {
        statements: [
          db.insert(notifications).values({
            type: "quote_decision",
            title: content.subject,
            body: doc.decisionComment,
            documentId: doc.id,
            createdAt: now,
          }),
        ],
      };
    },
  );
}

registerEmailJobHandlers();
