import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { NormalizedEvent, ProviderAdapter } from "mailswitch";
import { snsConfirmAction } from "mailswitch/ses";
import { D1DedupeStore } from "mailswitch/stores/d1";
import { handleWebhook } from "mailswitch/webhooks";
import { EMAIL_PROVIDER_ROLES, type EmailProviderRole } from "../../shared/domain";
import { createRequestDb, type Db, schema } from "../db/client";
import { createAdapter } from "../email/catalog";
import { loadEmailProvider, type ReadyEmailProvider } from "../email/settings";
import { bounceEmail } from "../email/templates";
import type { AppEnv } from "../env";
import { guardedActivity } from "../services/activity";
import { loadWorkspace } from "../services/documents";
import {
  appDocumentUrl,
  ownerEmails,
  SEND_EMAIL_JOB,
  type SendEmailJobPayload,
} from "../services/email";
import { enqueueStatement, runJobSoon, TICK_QUERY_BUDGET } from "../services/jobs";

/**
 * The largest webhook body, in bytes. One provider event is a few KB. A larger body is
 * refused before the webhook secret is read or decrypted.
 */
export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

/** How long the GET of an SNS `SubscribeURL` may take. */
const SUBSCRIBE_TIMEOUT_MS = 10_000;

/** Reads the body up to `max` bytes. Returns null when the body is larger. */
async function readCappedBody(request: Request, max: number): Promise<Uint8Array | null> {
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length.trim()) && Number(length) > max) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * The D1 queries of one webhook request, for the 50 query limit of Workers Free. One
 * batch() call is one query.
 * - before the events: the provider row, the workspace, and the owner emails (3);
 * - the dedupe claim and commit: one batch each per 500 keys. An adapter with body-bound
 *   keys (Mailgun) claims two keys per event;
 * - per bounce or complaint group: the email_log read, the document read,
 *   and one batch of writes (3);
 * - per SNS subscription: the activity row (1).
 */
const WEBHOOK_FIXED_QUERIES = 3;
const DEDUPE_KEYS_PER_BATCH = 500;
const WEBHOOK_GROUP_QUERIES = 3;

/**
 * The most D1 queries that a request with these events can use. It counts every event
 * key, because mailswitch claims every key, also for the types that the app ignores.
 */
function webhookQueries(adapter: ProviderAdapter, events: NormalizedEvent[]): number {
  const keysPerEvent = (adapter as { bodyBoundKeys?: boolean }).bodyBoundKeys === true ? 2 : 1;
  const keys = new Set(events.map((event) => event.eventKey)).size * keysPerEvent;
  const dedupeBatches = 2 * Math.ceil(keys / DEDUPE_KEYS_PER_BATCH);
  const confirms = events.filter((event) => snsConfirmAction(event) !== null).length;
  return (
    WEBHOOK_FIXED_QUERIES +
    dedupeBatches +
    groupEvents(events).length * WEBHOOK_GROUP_QUERIES +
    confirms
  );
}

/** Parses the body for the query count. Null when the parser throws. */
function parseForCount(
  adapter: ProviderAdapter,
  body: Uint8Array,
  headers: Headers,
): NormalizedEvent[] | null {
  try {
    return adapter.webhooks?.parse(body, headers) ?? null;
  } catch {
    return null;
  }
}

function isRole(value: string): value is EmailProviderRole {
  return (EMAIL_PROVIDER_ROLES as readonly string[]).includes(value);
}

/**
 * The one answer for every request that the app cannot authenticate: an unknown or
 * unconfigured role, a role with no webhook secret, and a bad or stale signature. The
 * same answer does not tell a caller which roles are set up.
 */
function unauthorized(c: Context<AppEnv>) {
  return c.json({ error: "Invalid signature", code: "invalid_signature" }, 401);
}

/** The bounces or complaints of one message in one request. */
interface EventGroup {
  kind: "bounced" | "complained";
  messageId: string;
  /** The key of the first event. The job guard uses it, so a replay writes nothing. */
  eventKey: string;
  recipients: Set<string>;
  bounce: "hard" | "soft" | null;
}

/** Groups the bounces and complaints by message, so one SES bounce of 3 recipients is one notice. */
function groupEvents(events: readonly NormalizedEvent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const event of events) {
    if (event.type !== "bounced" && event.type !== "complained") continue;
    // Without a message ID the app cannot find the email. Today's handler ignored these too.
    const messageId = event.providerMessageId;
    if (!messageId) continue;
    const id = `${event.type}:${messageId}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        kind: event.type,
        messageId,
        eventKey: event.eventKey,
        recipients: new Set(),
        bounce: null,
      };
      groups.set(id, group);
    }
    if (event.recipient) group.recipients.add(event.recipient);
    if (event.bounce === "hard" || (event.bounce === "soft" && group.bounce === null)) {
      group.bounce = event.bounce;
    }
  }
  return [...groups.values()];
}

function bounceReason(bounce: EventGroup["bounce"]): string | null {
  if (bounce === "hard") return "The address does not accept email (hard bounce)";
  if (bounce === "soft") return "A temporary delivery failure (soft bounce)";
  return null;
}

interface RecordContext {
  c: Context<AppEnv>;
  db: Db;
  provider: ReadyEmailProvider;
  now: number;
  /** The owner emails, read once per request. */
  owners: () => Promise<string[]>;
}

/**
 * Writes one bounce or complaint: the activity row, the in-app notification, the
 * email_log status, and an email job to the owners, in one D1 batch. Returns the job ID
 * when the job must run soon.
 */
async function recordGroup(ctx: RecordContext, group: EventGroup): Promise<string | null> {
  const { c, db, provider, now } = ctx;
  const { kind, messageId } = group;
  const logs = await db
    .select()
    .from(schema.emailLog)
    .where(eq(schema.emailLog.providerId, messageId));
  // Two providers can give the same message ID. A row from before the email_provider
  // column has no provider and still matches.
  const log = logs.find(
    (row) => row.emailProvider === null || row.emailProvider === provider.providerId,
  );
  const recipients = group.recipients.size > 0 ? [...group.recipients] : (log?.recipients ?? []);
  const subject = log?.subject ?? "";
  const reason = bounceReason(group.bounce);
  const [doc] = log?.documentId
    ? await db.select().from(schema.documents).where(eq(schema.documents.id, log.documentId))
    : [];

  const ws = await loadWorkspace(db);
  const content = bounceEmail({
    workspace: ws.businessName || ws.name,
    accent: ws.accentColor,
    url: doc ? appDocumentUrl(c.env, doc.kind, doc.id) : `${c.env.APP_URL ?? ""}`,
    event: kind,
    recipients,
    subject,
    number: doc?.number ?? null,
    reason,
  });
  const jobKey = `email_${kind}:${provider.providerId}:${provider.role}:${group.eventKey}`;
  // A bounce on an owner notification must not email the owners again (a loop). It gets
  // the status and the in-app notification only. The job row with no recipients still
  // marks this event as handled.
  const ownerNotice = log?.kind === "notification";
  const payload: SendEmailJobPayload = {
    to: ownerNotice ? [] : await ctx.owners(),
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "notification",
    documentId: doc?.id ?? null,
  };
  const d1 = c.env.DB;
  // The dedupe store stops a replay first. This guard also makes a second delivery of
  // the same event a no-op, for example after the dedupe row expired.
  const fresh = "NOT EXISTS (SELECT 1 FROM jobs WHERE idempotency_key = ?)";
  const activityType = kind === "bounced" ? "email_bounced" : "email_complained";
  const statements: D1PreparedStatement[] = [];
  if (doc && !ownerNotice) {
    statements.push(
      guardedActivity(
        d1,
        {
          documentId: doc.id,
          clientId: doc.clientId,
          type: activityType,
          data: {
            providerId: messageId,
            provider: provider.providerId,
            recipients,
            bounce: group.bounce,
            reason,
          },
          now,
        },
        fresh,
        [jobKey],
      ),
    );
  }
  statements.push(
    d1
      .prepare(
        `INSERT INTO notifications (id, type, title, body, document_id, read_at, created_at)
         SELECT ?, ?, ?, ?, ?, NULL, ? WHERE ${fresh}`,
      )
      .bind(
        crypto.randomUUID(),
        activityType,
        content.subject,
        `To ${recipients.join(", ")}: ${subject}`,
        doc?.id ?? null,
        now,
        jobKey,
      ),
  );
  if (log) {
    statements.push(d1.prepare("UPDATE email_log SET status = ? WHERE id = ?").bind(kind, log.id));
  }
  const insertJob = enqueueStatement(
    db,
    { type: SEND_EMAIL_JOB, payload, idempotencyKey: jobKey },
    now,
  ).toSQL();
  statements.push(d1.prepare(`${insertJob.sql} RETURNING id`).bind(...insertJob.params));
  const results = await d1.batch(statements);
  const jobId = (results.at(-1)?.results[0] as { id?: string } | undefined)?.id;
  return jobId && payload.to.length ? jobId : null;
}

/**
 * Confirms an SNS subscription: one GET of the `SubscribeURL`, then an activity row.
 * mailswitch checked that the URL is an SNS host of an allowlisted topic. A failed GET
 * throws, so the handler releases the event and SNS sends it again.
 */
async function confirmSubscription(
  ctx: RecordContext,
  action: { topicArn: string; subscribeUrl: string },
): Promise<void> {
  const res = await fetch(action.subscribeUrl, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(SUBSCRIBE_TIMEOUT_MS),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`The SNS subscription was not confirmed: HTTP ${res.status}`);
  await ctx.db.insert(schema.activity).values({
    type: "email_webhook_confirmed",
    data: { provider: ctx.provider.providerId, role: ctx.provider.role, topicArn: action.topicArn },
    createdAt: ctx.now,
  });
}

/**
 * Provider webhooks, mounted at /api/webhooks. The session check and the cross-site guard
 * skip `/api/webhooks/` (SESSION_EXEMPT_PREFIXES and CSRF_EXEMPT_PREFIXES). The provider
 * signature authenticates each
 * request instead, with the webhook secret that the Owner saved for the role.
 */
export const webhookRoutes = new Hono<AppEnv>().post("/email/:role", async (c) => {
  const body = await readCappedBody(c.req.raw, WEBHOOK_MAX_BODY_BYTES);
  if (!body) return c.json({ error: "The request body is too large", code: "too_large" }, 413);

  const role = c.req.param("role");
  if (!isRole(role)) return unauthorized(c);
  const db = createRequestDb(c.env.DB);
  const provider = await loadEmailProvider(db, c.env.ENCRYPTION_KEY, role);
  if (provider?.status !== "ready" || !provider.webhookSecret) return unauthorized(c);
  // One adapter per isolate for SES, so its certificate cache lives between requests.
  const adapter = createAdapter(provider.providerId);
  if (!adapter.webhooks) return unauthorized(c);

  // A request that would pass the D1 query limit fails part way, after some events
  // are claimed or written. Refuse it before any write. Only a verified request gets the
  // 500, so an unsigned request still gets the 401 below.
  const parsed = parseForCount(adapter, body, c.req.raw.headers);
  const queries = parsed ? webhookQueries(adapter, parsed) : 0;
  if (queries > TICK_QUERY_BUDGET) {
    const verified = await adapter.webhooks.verify({
      headers: c.req.raw.headers,
      body,
      secret: provider.webhookSecret,
      now: Date.now(),
    });
    if (verified.ok) {
      console.error(
        `The ${role} webhook from ${provider.providerId} has ${parsed?.length ?? 0} events, ` +
          `which needs up to ${queries} D1 queries. The limit is ${TICK_QUERY_BUDGET}. ` +
          "Nothing was recorded. In the provider webhook settings, select only the bounce " +
          "and spam complaint events, and turn off event grouping where the provider has it.",
      );
      return c.json({ error: "The webhook has too many events", code: "too_many_events" }, 500);
    }
  }
  const outcome = await handleWebhook(
    new Request(c.req.url, { method: "POST", headers: c.req.raw.headers, body }),
    {
      adapter,
      secret: provider.webhookSecret,
      dedupe: new D1DedupeStore(c.env.DB),
      endpointId: role,
      maxBodyBytes: WEBHOOK_MAX_BODY_BYTES,
    },
  );
  if (!outcome.ok) {
    if (outcome.status === 401) return unauthorized(c);
    // The saved secret does not fit the provider, for example a short Postmark password
    // or a Resend secret that is not whsec_ base64. mailswitch checks it before the
    // signature, so the 401 keeps an unsigned caller from learning that the role is set
    // up. The Owner must save a new secret.
    if (outcome.rejection === "invalid_secret") {
      console.error(`The ${role} webhook secret is not valid`);
      return unauthorized(c);
    }
    if (outcome.status === 200) return c.json({ ok: true });
    return c.json(
      { error: "The webhook was refused", code: outcome.rejection },
      outcome.status as ContentfulStatusCode,
    );
  }

  let ownerList: Promise<string[]> | undefined;
  const ctx: RecordContext = {
    c,
    db,
    provider,
    now: Date.now(),
    owners: () => {
      ownerList ??= ownerEmails(db);
      return ownerList;
    },
  };
  const jobIds: string[] = [];
  try {
    for (const event of outcome.events) {
      const action = snsConfirmAction(event);
      if (action) await confirmSubscription(ctx, action);
    }
    for (const group of groupEvents(outcome.events)) {
      const jobId = await recordGroup(ctx, group);
      if (jobId) jobIds.push(jobId);
    }
  } catch (err) {
    console.error(`The ${role} webhook events were not recorded`, err);
    // Frees the events, so a provider that retries delivers them again.
    await outcome.release().catch(() => undefined);
    return c.json({ error: "The events were not recorded", code: "webhook_failed" }, 500);
  }
  // Only after the writes, so a failed write never marks an event as handled.
  await outcome.ack();

  for (const jobId of jobIds) {
    try {
      runJobSoon(c.executionCtx, c.env, jobId);
    } catch {
      // No execution context (tests). The cron tick runs the job.
    }
  }
  return c.json({ ok: true });
});
