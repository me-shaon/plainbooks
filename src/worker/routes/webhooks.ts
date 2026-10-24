import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, schema } from "../db/client";
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
import { enqueueStatement, runJobSoon } from "../services/jobs";

/** Svix rejects messages whose timestamp is more than 5 minutes from now. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/**
 * Verifies a Svix signature (used by Resend webhooks): HMAC-SHA256 over
 * "<svix-id>.<svix-timestamp>.<raw body>" with the base64 key after "whsec_". The header
 * holds space-separated "v1,<base64>" entries; any match is valid.
 */
export async function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  body: string,
  nowMs: number,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  const expected = bytesToBase64(mac);
  return signature
    .split(" ")
    .map((entry) => entry.split(","))
    .some(
      ([version, sig]) => version === "v1" && sig !== undefined && constantTimeEqual(sig, expected),
    );
}

interface ResendEvent {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    bounce?: { message?: string; type?: string };
  };
}

const HANDLED = {
  "email.bounced": "bounced",
  "email.complained": "complained",
} as const;

/**
 * Resend webhooks, mounted at /api/webhooks. Access does not cover /api/webhooks/resend
 * (AUTH_EXEMPT_PATHS); the Svix signature authenticates it instead.
 */
export const webhookRoutes = new Hono<AppEnv>().post("/resend", async (c) => {
  const secret = c.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "Webhook secret is not set" }, 500);
  const body = await c.req.text();
  const valid = await verifySvixSignature(
    secret,
    {
      id: c.req.header("svix-id"),
      timestamp: c.req.header("svix-timestamp"),
      signature: c.req.header("svix-signature"),
    },
    body,
    Date.now(),
  );
  if (!valid) return c.json({ error: "Invalid signature", code: "invalid_signature" }, 400);

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return c.json({ error: "Invalid JSON", code: "invalid_json" }, 400);
  }
  const kind = HANDLED[event.type as keyof typeof HANDLED];
  const providerId = event.data?.email_id;
  if (!kind || !providerId) return c.json({ ok: true, ignored: true });

  const db = createDb(c.env.DB);
  const now = Date.now();
  const svixId = c.req.header("svix-id") as string;
  const [log] = await db
    .select()
    .from(schema.emailLog)
    .where(eq(schema.emailLog.providerId, providerId));
  const recipients = log?.recipients ?? [event.data?.to ?? []].flat();
  const subject = log?.subject ?? event.data?.subject ?? "";
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
    reason: event.data?.bounce?.message ?? null,
  });
  const jobKey = `email_${kind}:${svixId}`;
  // A bounce on an owner notification must not email the owners again (a loop). It gets
  // the status and the in-app notification only. The job row with no recipients still
  // marks this svix-id as handled.
  const ownerNotice = log?.kind === "notification";
  const payload: SendEmailJobPayload = {
    to: ownerNotice ? [] : await ownerEmails(db),
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "notification",
    documentId: doc?.id ?? null,
  };
  const d1 = c.env.DB;
  // The guard makes a replayed webhook (same svix-id) a no-op.
  const fresh = "NOT EXISTS (SELECT 1 FROM jobs WHERE idempotency_key = ?)";
  const statements: D1PreparedStatement[] = [];
  if (doc && !ownerNotice) {
    statements.push(
      guardedActivity(
        d1,
        {
          documentId: doc.id,
          clientId: doc.clientId,
          type: kind === "bounced" ? "email_bounced" : "email_complained",
          data: { providerId, recipients, reason: event.data?.bounce?.message ?? null },
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
        kind === "bounced" ? "email_bounced" : "email_complained",
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
  if (jobId && payload.to.length) {
    try {
      runJobSoon(c.executionCtx, c.env, jobId);
    } catch {
      // No execution context (tests). The cron tick runs the job.
    }
  }
  return c.json({ ok: true });
});
