import { env } from "cloudflare:workers";
import type { OutgoingMessage, ProviderAdapter } from "mailswitch";
import { fakeProvider } from "mailswitch/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documentUpdateInput } from "../../src/shared/schemas/document";
import { schema } from "../../src/worker/db/client";
import { setMailerEntriesForTesting } from "../../src/worker/email/mailer";
import { QUOTE_DECISION_JOB } from "../../src/worker/routes/public";
import { decideQuote, revise, voidDocument } from "../../src/worker/services/documents";
import {
  CAPACITY_RECHECK_MS,
  defaultRecipients,
  EmailSendError,
  emailJobOutcome,
  markSentManually,
  ownerEmails,
  registerEmailJobHandlers,
  SEND_DOCUMENT_JOB,
  SEND_EMAIL_JOB,
  sendDocument,
} from "../../src/worker/services/email";
import { enqueue, runJobById } from "../../src/worker/services/jobs";
import { pdfKey, setPdfRendererForTesting } from "../../src/worker/services/pdf";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";
import {
  activityTypes,
  counterValue,
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  TODAY,
} from "../helpers/documents";
import {
  dailyCapUsed,
  type FakeEmail,
  fillDailyCap,
  resetEmailState,
  restoreEmail,
  useFakeEmail,
} from "../helpers/email";
import { failingRenderer, PDF_BYTES, resetPdfState, stubRenderer } from "../helpers/pdf";

let clientId: string;
let renderer: ReturnType<typeof stubRenderer>;
let email: FakeEmail;

const PRIMARY = { providerId: "tosend", role: "primary" } as const;
const FALLBACK = { providerId: "tosend", role: "fallback" } as const;
/** When a bucket filled at NOW leaves the 24-hour window. */
const RESET_AT = Math.floor(NOW / 300_000) * 300_000 + 300_000 + 86_400_000;

async function docRow(id: string) {
  return env.DB.prepare("SELECT status, number, public_token AS token FROM documents WHERE id = ?")
    .bind(id)
    .first<{ status: string; number: string | null; token: string }>();
}

async function jobRow(id: string) {
  return env.DB.prepare("SELECT status, attempts, last_error, run_after FROM jobs WHERE id = ?")
    .bind(id)
    .first<{ status: string; attempts: number; last_error: string | null; run_after: number }>();
}

async function emailLogRows() {
  const rows = await env.DB.prepare(
    `SELECT status, provider_id, email_provider, idempotency_key, kind, day, error
     FROM email_log ORDER BY created_at, rowid`,
  ).all<Record<string, unknown>>();
  return rows.results;
}

async function idempotencyRecords() {
  const rows = await env.DB.prepare(
    "SELECT key, state FROM mailswitch_idempotency ORDER BY key",
  ).all<{ key: string; state: string }>();
  return rows.results;
}

async function notificationTypes(): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT type FROM notifications ORDER BY created_at").all<{
    type: string;
  }>();
  return rows.results.map((r) => r.type);
}

function bytesOf(message: OutgoingMessage | undefined): Uint8Array | undefined {
  const content = message?.attachments?.[0]?.content;
  return content instanceof Uint8Array ? content : undefined;
}

const sendNote = (key: string, subject = "Hi") =>
  enqueue(
    db,
    {
      type: SEND_EMAIL_JOB,
      payload: { to: ["owner@studio.test"], subject, html: "<p>Hi</p>", text: "Hi" },
      idempotencyKey: key,
    },
    NOW,
  );

beforeAll(() => {
  registerEmailJobHandlers();
});

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await clearUsers();
  clientId = (await seedClient()).id;
  await db.insert(schema.clientContacts).values([
    { clientId, email: "Billing@Northwind.test", isBilling: true, name: "Bill" },
    { clientId, email: "other@northwind.test" },
  ]);
  renderer = stubRenderer();
  setPdfRendererForTesting(renderer);
  email = await useFakeEmail();
});

afterEach(() => {
  setPdfRendererForTesting(null);
  restoreEmail();
});

describe("sendDocument", () => {
  it("finalizes a draft, attaches the stored PDF, sends once through toSend, and marks it sent", async () => {
    const id = await draft({ clientId });
    const result = await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });

    expect(result.document.status).toBe("sent");
    expect(result.emailId).toBe("tosend-1");
    expect(email.primary.sends).toHaveLength(1);
    const message = email.messages()[0];
    expect(message?.from).toEqual({ email: "billing@studio.test", name: "Studio One" });
    expect(message?.replyTo).toBe("hello@studio.test");
    expect(message?.to).toEqual(["ap@northwind.test", "billing@northwind.test"]);
    expect(message?.subject).toBe("Invoice INV-0001 from Studio One");
    expect(message?.idempotencyKey).toBe(`document:${id}:send:0`);
    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments?.[0]).toMatchObject({
      filename: "INV-0001.pdf",
      contentType: "application/pdf",
    });
    // The attachment is the R2 object of the revision.
    const stored = await env.BUCKET.get(pdfKey(result.revisionId));
    expect(bytesOf(message)).toEqual(new Uint8Array((await stored?.arrayBuffer()) ?? []));
    expect(bytesOf(message)).toEqual(PDF_BYTES);
    const token = (await docRow(id))?.token;
    expect(message?.html).toContain(`https://invoices.example.com/p/${token}`);
    expect(message?.text).toContain(`https://invoices.example.com/p/${token}`);
    expect(await activityTypes(id)).toEqual(["created", "finalized", "sent"]);

    expect(await emailLogRows()).toEqual([
      {
        status: "sent",
        provider_id: "tosend-1",
        email_provider: "tosend",
        idempotency_key: `document:${id}:send:0`,
        kind: "document",
        day: TODAY,
        error: null,
      },
    ]);
    expect(await idempotencyRecords()).toEqual([
      { key: `plainbooks:document:${id}:send:0`, state: "sent" },
    ]);
  });

  it("uses edited recipients, subject, and an escaped message", async () => {
    const id = await draft({ clientId });
    await sendDocument(env, db, id, {
      now: NOW,
      fetcher: noFetch,
      recipients: ["CFO@northwind.test", "cfo@northwind.test"],
      subject: "Your October invoice",
      message: "Thanks <b>a lot</b>",
    });
    const message = email.messages()[0];
    expect(message?.to).toEqual(["cfo@northwind.test"]);
    expect(message?.subject).toBe("Your October invoice");
    expect(message?.html).toContain("Thanks &lt;b&gt;a lot&lt;/b&gt;");
    expect(message?.html).not.toContain("<b>a lot</b>");
  });

  it("keeps the number after not_sent, and the retry reuses the key and the R2 bytes", async () => {
    email = await useFakeEmail({ primary: { outcomes: ["not_sent"] } });
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 422,
      code: "email_rejected",
    });
    expect(await docRow(id)).toMatchObject({ status: "finalized", number: "INV-0001" });
    expect(await activityTypes(id)).toEqual(["created", "finalized", "send_failed"]);
    expect((await emailLogRows())[0]).toMatchObject({
      status: "failed",
      email_provider: "tosend",
      idempotency_key: `document:${id}:send:0`,
    });

    // Replace the stored PDF. The retry must attach the stored object, not render again.
    const revisionId = (
      await env.DB.prepare("SELECT current_revision_id AS r FROM documents WHERE id = ?")
        .bind(id)
        .first<{ r: string }>()
    )?.r;
    const storedBytes = new TextEncoder().encode("%PDF-1.7 stored in R2");
    await env.BUCKET.put(pdfKey(revisionId ?? ""), storedBytes);

    const retry = await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    expect(retry.document).toMatchObject({ status: "sent", number: "INV-0001" });
    expect(await counterValue("invoice")).toBe(1);
    expect(renderer.calls).toHaveLength(1);
    expect(email.primary.sends).toHaveLength(2);
    // A not_sent attempt frees the key, so the retry uses the same one.
    expect(email.messages()[1]?.idempotencyKey).toBe(`document:${id}:send:0`);
    expect(bytesOf(email.messages()[1])).toEqual(storedBytes);
  });

  it("maps a provider error that a retry can fix to 502 email_send_failed", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "not_sent", reason: "credits", message: "No credits left." }],
      },
    });
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 502,
      code: "email_send_failed",
    });
  });

  it("returns needs review for an unclear send, and a second click sends nothing", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "unknown", reason: "timeout", message: "The request timed out." }],
      },
    });
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 502,
      code: "email_needs_review",
    });
    expect(await docRow(id)).toMatchObject({ status: "finalized", number: "INV-0001" });
    expect((await emailLogRows())[0]).toMatchObject({
      status: "unknown",
      provider_id: null,
      idempotency_key: `document:${id}:send:0`,
    });
    expect(await idempotencyRecords()).toEqual([
      { key: `plainbooks:document:${id}:send:0`, state: "unknown" },
    ]);

    // The unknown row does not count, so the key stays blocked and mailswitch refuses it.
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      code: "email_needs_review",
    });
    expect(email.primary.sends).toHaveLength(1);
    expect((await docRow(id))?.status).toBe("finalized");
  });

  it("answers 409 for a parallel manual send, with no review job, while the first send succeeds", async () => {
    // The first send waits inside the provider call, so it holds the mailswitch claim.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const fake = email.primary;
    const slow: ProviderAdapter = {
      ...fake,
      send: async (message, ctx) => {
        entered();
        await gate;
        return fake.send(message, ctx);
      },
    };
    setMailerEntriesForTesting(() => ({ adapter: slow, credentials: { apiKey: "fk_test" } }));
    const id = await draft({ clientId });
    const first = sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    await reached;

    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 409,
      code: "email_send_in_progress",
    });
    release();
    expect((await first).document.status).toBe("sent");
    expect(fake.sends).toHaveLength(1);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM jobs").first("n")).toBe(0);
    expect(await notificationTypes()).toEqual([]);
    expect((await emailLogRows()).map((r) => r.status)).toEqual(["sent"]);
    expect(await activityTypes(id)).toEqual(["created", "finalized", "sent"]);
  });

  it("AE6: a primary at its daily cap sends through the fallback", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [
          { status: "not_sent", reason: "daily_cap", message: "Cap reached.", resetAt: NOW + 1 },
        ],
      },
      fallback: { providerId: "resend" },
    });
    const id = await draft({ clientId });
    const result = await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    expect(result.document.status).toBe("sent");
    expect(email.primary.sends).toHaveLength(1);
    expect(email.fallback?.sends).toHaveLength(1);
    expect(await emailLogRows()).toEqual([
      expect.objectContaining({
        status: "sent",
        provider_id: "resend-1",
        email_provider: "resend",
      }),
    ]);
  });

  it("AE6: an unclear primary result never falls back", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "unknown", reason: "timeout", message: "The request timed out." }],
      },
      fallback: {},
    });
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      code: "email_needs_review",
    });
    expect(email.primary.sends).toHaveLength(1);
    expect(email.fallback?.sends).toHaveLength(0);
  });

  it("keeps separate cap counters for two accounts of one provider", async () => {
    email = await useFakeEmail({ primary: { dailyCap: 2 }, fallback: { dailyCap: 5 } });
    await sendDocument(env, db, await draft({ clientId }), { now: NOW, fetcher: noFetch });
    expect(await dailyCapUsed(PRIMARY, NOW)).toBe(1);
    expect(await dailyCapUsed(FALLBACK, NOW)).toBe(0);

    await fillDailyCap(PRIMARY, 1, NOW);
    await sendDocument(env, db, await draft({ clientId }), { now: NOW, fetcher: noFetch });
    expect(await dailyCapUsed(PRIMARY, NOW)).toBe(2);
    expect(await dailyCapUsed(FALLBACK, NOW)).toBe(1);
    expect(email.primary.sends).toHaveLength(1);
    expect(email.fallback?.sends).toHaveLength(1);
  });

  it("returns 429 when every provider is at its cap, before it uses a number", async () => {
    email = await useFakeEmail({ primary: { providerId: "resend" }, fallback: { dailyCap: 5 } });
    await fillDailyCap({ providerId: "resend", role: "primary" }, 100, NOW);
    await fillDailyCap(FALLBACK, 5, NOW);
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 429,
      code: "daily_email_limit",
    });
    expect(await docRow(id)).toMatchObject({ status: "draft", number: null });
    expect(await counterValue("invoice")).toBe(0);
    expect(email.primary.sends).toHaveLength(0);
    expect(email.fallback?.sends).toHaveLength(0);
  });

  it("sends when only the primary is at its cap", async () => {
    email = await useFakeEmail({ primary: { dailyCap: 3 }, fallback: {} });
    await fillDailyCap(PRIMARY, 3, NOW);
    const id = await draft({ clientId });
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    expect(email.primary.sends).toHaveLength(0);
    expect(email.fallback?.sends).toHaveLength(1);
  });

  it("returns 422 email_not_configured with no provider, and uses no number", async () => {
    await resetEmailState();
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 422,
      code: "email_not_configured",
    });
    expect((await docRow(id))?.number).toBeNull();
    expect(await counterValue("invoice")).toBe(0);
  });

  it("returns 422 when the stored keys no longer decrypt, and sends nothing", async () => {
    const id = await draft({ clientId });
    const changedKey = { ...env, ENCRYPTION_KEY: btoa("a-different-encryption-key-01234") };
    await expect(
      sendDocument(changedKey, db, id, { now: NOW, fetcher: noFetch }),
    ).rejects.toMatchObject({ status: 422, code: "email_not_configured" });
    expect((await docRow(id))?.number).toBeNull();
    expect(email.primary.sends).toHaveLength(0);
  });

  it("returns 422 when mailswitch refuses the keys, and never throws the TypeError", async () => {
    setMailerEntriesForTesting(() => ({ adapter: fakeProvider(), credentials: { apiKey: "bad" } }));
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 422,
      code: "email_not_configured",
    });
  });

  it("requires a sender address", async () => {
    await env.DB.prepare("UPDATE workspace SET email_from_address = NULL").run();
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      code: "email_not_configured",
    });
    expect((await docRow(id))?.number).toBeNull();
  });

  it("blocks the send when the PDF fails, and never calls the provider", async () => {
    setPdfRendererForTesting(failingRenderer());
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 502,
      code: "pdf_render_failed",
    });
    expect(email.primary.sends).toHaveLength(0);
    expect((await docRow(id))?.status).toBe("finalized");
    expect(await activityTypes(id)).toContain("send_failed");
  });

  it("uses the updated-invoice email and a new key for a revised invoice", async () => {
    const id = await draft({ clientId });
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    await revise(db, id, documentUpdateInput.parse({ notes: "Fixed" }), {
      now: NOW,
      fetcher: noFetch,
    });
    await env.DB.prepare("DELETE FROM leases").run();
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    expect(email.messages()[1]?.subject).toBe("Updated invoice INV-0001 from Studio One");
    expect(email.messages()[1]?.idempotencyKey).toBe(`document:${id}:send:1`);
  });

  it("counts a bounced send, so a send after a bounce gets a new key", async () => {
    const id = await draft({ clientId });
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    await env.DB.prepare("UPDATE email_log SET status = 'bounced'").run();
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    expect(email.primary.sends).toHaveLength(2);
    expect(email.messages()[1]?.idempotencyKey).toBe(`document:${id}:send:1`);
  });
});

describe("defaultRecipients and markSentManually", () => {
  it("returns the primary contact first, then billing contacts", async () => {
    expect(await defaultRecipients(db, clientId)).toEqual([
      "ap@northwind.test",
      "billing@northwind.test",
    ]);
  });

  it("marks a draft sent without an email", async () => {
    const id = await draft({ clientId });
    const { document } = await markSentManually(db, id, { now: NOW, fetcher: noFetch });
    expect(document).toMatchObject({ status: "sent", number: "INV-0001" });
    expect(email.primary.sends).toHaveLength(0);
    expect(await activityTypes(id)).toEqual(["created", "finalized", "sent"]);
  });

  it("refuses a void invoice", async () => {
    const id = await draft({ clientId });
    await markSentManually(db, id, { now: NOW, fetcher: noFetch });
    await voidDocument(db, id, { now: NOW });
    await expect(markSentManually(db, id, { now: NOW })).rejects.toMatchObject({
      code: "document_void",
    });
  });
});

describe("email jobs", () => {
  const autoSend = (id: string) =>
    enqueue(
      db,
      { type: SEND_DOCUMENT_JOB, payload: { documentId: id }, idempotencyKey: `auto:${id}` },
      NOW,
    );

  it("send_document sends with trigger auto and the job key", async () => {
    const id = await draft({ clientId });
    const job = await autoSend(id);
    expect(await runJobById(env, job.id, NOW)).toBe("done");
    expect(email.messages()[0]?.idempotencyKey).toBe(`job:${job.id}`);
    expect((await docRow(id))?.status).toBe("sent");
    const log = await env.DB.prepare(
      "SELECT trigger, idempotency_key AS key FROM email_log",
    ).first();
    expect(log).toEqual({ trigger: "auto", key: `job:${job.id}` });
    expect(await idempotencyRecords()).toEqual([
      { key: `plainbooks:job:${job.id}`, state: "sent" },
    ]);
  });

  it("send_document waits, without a number or an attempt, while every provider is capped", async () => {
    email = await useFakeEmail({ primary: { dailyCap: 1 } });
    await fillDailyCap(PRIMARY, 1, NOW);
    const id = await draft({ clientId });
    const job = await autoSend(id);
    expect(await runJobById(env, job.id, NOW)).toBe("deferred");
    expect(await jobRow(job.id)).toEqual({
      status: "pending",
      attempts: 0,
      last_error: "daily_email_limit",
      run_after: NOW + CAPACITY_RECHECK_MS,
    });
    expect(await docRow(id)).toMatchObject({ status: "draft", number: null });
    expect(email.primary.sends).toHaveLength(0);
  });

  it("send_document waits without using an attempt while the browser is busy", async () => {
    await env.DB.prepare(
      "INSERT INTO leases (name, holder, expires_at, last_used_at) VALUES ('browser', 'other', ?, 0)",
    )
      // getPdf reads the lease with the real clock.
      .bind(Date.now() + 60 * 60_000)
      .run();
    const id = await draft({ clientId });
    const job = await autoSend(id);
    expect(await runJobById(env, job.id, NOW)).toBe("deferred");
    expect(await jobRow(job.id)).toMatchObject({
      status: "pending",
      attempts: 0,
      last_error: "pdf_pending",
    });
    expect(email.primary.sends).toHaveLength(0);
  });

  it("AE5: a job that runs again after a stored sent result makes no second provider call", async () => {
    const job = await sendNote("note-ae5");
    expect(await runJobById(env, job.id, NOW)).toBe("done");
    // The isolate stopped before it recorded the result: the job runs again.
    await env.DB.prepare("UPDATE jobs SET status = 'pending' WHERE id = ?").bind(job.id).run();
    expect(await runJobById(env, job.id, NOW + 60_000)).toBe("done");
    expect(email.primary.sends).toHaveLength(1);
    const rows = await emailLogRows();
    expect(rows.map((r) => [r.status, r.idempotency_key])).toEqual([
      ["sent", `job:${job.id}`],
      ["sent", `job:${job.id}`],
    ]);
  });

  it("a job retry after the document subject changed goes to needs review, with no second send", async () => {
    const id = await draft({ clientId });
    const job = await autoSend(id);
    expect(await runJobById(env, job.id, NOW)).toBe("done");
    await env.DB.prepare(
      "UPDATE jobs SET status = 'pending', payload = json_set(payload, '$.subject', 'Changed') WHERE id = ?",
    )
      .bind(job.id)
      .run();

    expect(await runJobById(env, job.id, NOW + 60_000)).toBe("needs_review");
    expect(email.primary.sends).toHaveLength(1);
    const row = await jobRow(job.id);
    expect(row?.status).toBe("needs_review");
    expect(row?.last_error).toContain("unknown/idempotency_conflict");
    expect(await notificationTypes()).toEqual(["job_needs_review"]);
    // The scheduler never claims it again.
    expect(await runJobById(env, job.id, NOW + 120_000)).toBeNull();
  });

  it("an unclear send moves the job to needs review and notifies the Owner", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "unknown", reason: "timeout", message: "The request timed out." }],
      },
    });
    const job = await sendNote("note-unknown");
    expect(await runJobById(env, job.id, NOW)).toBe("needs_review");
    expect(await jobRow(job.id)).toMatchObject({ status: "needs_review", attempts: 1 });
    expect(await notificationTypes()).toEqual(["job_needs_review"]);
    expect(await runJobById(env, job.id, NOW + 24 * 60 * 60_000)).toBeNull();
    expect(email.primary.sends).toHaveLength(1);
  });

  it("not_sent/auth fails the job at once and notifies the Owner", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "not_sent", reason: "auth", message: "The key was refused." }],
      },
    });
    const job = await sendNote("note-auth");
    expect(await runJobById(env, job.id, NOW)).toBe("failed");
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row?.last_error).toContain("not_sent/auth");
    expect(await notificationTypes()).toEqual(["job_failed"]);
  });

  it("every provider at its cap reschedules the job to resetAt, without using an attempt", async () => {
    email = await useFakeEmail({ primary: { dailyCap: 2 }, fallback: { dailyCap: 1 } });
    await fillDailyCap(PRIMARY, 2, NOW);
    await fillDailyCap(FALLBACK, 1, NOW);
    const job = await sendNote("note-capped");
    expect(await runJobById(env, job.id, NOW)).toBe("deferred");
    expect(await jobRow(job.id)).toEqual({
      status: "pending",
      attempts: 0,
      last_error: "daily_cap",
      run_after: RESET_AT,
    });
    expect(email.primary.sends).toHaveLength(0);
    expect(email.fallback?.sends).toHaveLength(0);

    expect(await runJobById(env, job.id, RESET_AT)).toBe("done");
    expect(email.primary.sends).toHaveLength(1);
  });

  it("a rate limit with retryAfterMs reschedules the job after that wait", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [
          {
            status: "not_sent",
            reason: "rate_limited",
            message: "Slow down.",
            retryAfterMs: 30_000,
          },
        ],
      },
    });
    const job = await sendNote("note-rate");
    expect(await runJobById(env, job.id, NOW)).toBe("deferred");
    expect(await jobRow(job.id)).toMatchObject({
      status: "pending",
      attempts: 0,
      last_error: "rate_limited",
      run_after: NOW + 30_000,
    });
  });

  it("a retryable not_sent with no wait time retries with backoff", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "not_sent", reason: "credits", message: "No credits left." }],
      },
    });
    const job = await sendNote("note-credits");
    expect(await runJobById(env, job.id, NOW)).toBe("retry");
    expect(await jobRow(job.id)).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("a not_sent network error retries with backoff instead of failing the job", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "not_sent", reason: "network", message: "The connection failed." }],
      },
    });
    const job = await sendNote("note-network");
    expect(await runJobById(env, job.id, NOW)).toBe("retry");
    expect(await jobRow(job.id)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await notificationTypes()).toEqual([]);
  });

  it("send_email with no saved provider fails like before and retries", async () => {
    await resetEmailState();
    const job = await sendNote("note-none");
    expect(await runJobById(env, job.id, NOW)).toBe("retry");
    expect((await jobRow(job.id))?.last_error).toContain("email provider");
  });

  it("notify_quote_decision emails the sender and every Owner with the comment escaped", async () => {
    const owner = await seedUser("owner@studio.test", "owner");
    const owner2 = await seedUser("owner2@studio.test", "owner");
    const sender = await seedUser("sender@studio.test", "member");
    await seedUser("bystander@studio.test", "member");
    // An Owner who has not joined yet gets no email.
    const invited = await seedUser("invited@studio.test", "owner", { status: "invited" });
    const id = await draft({ clientId, kind: "quote" });
    await sendDocument(env, db, id, {
      now: NOW,
      fetcher: noFetch,
      actor: { id: sender.id, email: sender.email, name: null, role: "member" },
    });
    const token = (await docRow(id))?.token ?? "";
    await decideQuote(
      db,
      token,
      { decision: "accept", comment: '<script>alert("x")</script> & thanks' },
      { now: NOW },
    );
    const job = await enqueue(
      db,
      {
        type: QUOTE_DECISION_JOB,
        payload: {
          documentId: id,
          decision: "accepted",
          recipientUserIds: [sender.id, owner.id, owner2.id, invited.id],
        },
        idempotencyKey: `${QUOTE_DECISION_JOB}:${id}`,
      },
      NOW,
    );
    expect(await runJobById(env, job.id, NOW)).toBe("done");

    const message = email.messages()[1];
    expect([...(message?.to ?? [])].sort()).toEqual(
      ["owner2@studio.test", "owner@studio.test", "sender@studio.test"].sort(),
    );
    expect(message?.subject).toBe("Northwind accepted quote Q-0001");
    expect(message?.idempotencyKey).toBe(`job:${job.id}`);
    expect(message?.html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; thanks",
    );
    expect(message?.html).not.toContain("<script>");
    expect(message?.html).toContain(`https://invoices.example.com/quotes/${id}`);

    const notes = await env.DB.prepare("SELECT type, document_id FROM notifications").all();
    expect(notes.results).toEqual([{ type: "quote_decision", document_id: id }]);
  });
});

describe("notify_quote_decision at the daily cap", () => {
  it("adds the in-app notification at once and sends the email at resetAt", async () => {
    email = await useFakeEmail({ primary: { dailyCap: 1 } });
    const owner = await seedUser("owner@studio.test", "owner");
    const id = await draft({ clientId, kind: "quote" });
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    const token = (await docRow(id))?.token ?? "";
    await decideQuote(db, token, { decision: "accept", comment: "" }, { now: NOW });
    const job = await enqueue(
      db,
      {
        type: QUOTE_DECISION_JOB,
        payload: { documentId: id, decision: "accepted", recipientUserIds: [owner.id] },
        idempotencyKey: `${QUOTE_DECISION_JOB}:${id}`,
      },
      NOW,
    );
    expect(await runJobById(env, job.id, NOW)).toBe("deferred");
    const notes = () => env.DB.prepare("SELECT type FROM notifications").all();
    expect((await notes()).results).toEqual([{ type: "quote_decision" }]);
    expect(email.primary.sends).toHaveLength(1); // only the quote email from the send above
    expect((await jobRow(job.id))?.run_after).toBe(RESET_AT);

    expect(await runJobById(env, job.id, RESET_AT)).toBe("done");
    expect(email.messages()[1]?.to).toEqual(["owner@studio.test"]);
    // The retried job did not add a second notification.
    expect((await notes()).results).toEqual([{ type: "quote_decision" }]);
  });
});

describe("send routes", () => {
  beforeEach(async () => {
    await seedUser("member@studio.test", "member");
  });

  it("POST /:id/send sends and returns the detail", async () => {
    const id = await draft({ clientId, currency: "BDT" });
    const res = await apiFetch(`/api/documents/${id}/send`, {
      as: "member@studio.test",
      method: "POST",
      json: { message: "Hello" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { status: string }; emailId: string };
    expect(body.document.status).toBe("sent");
    expect(body.emailId).toBe("tosend-1");
  });

  it("validates recipients", async () => {
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/send`, {
      as: "member@studio.test",
      method: "POST",
      json: { recipients: ["not-an-email"] },
    });
    expect(res.status).toBe(400);
    expect(email.primary.sends).toHaveLength(0);
  });

  it("returns 429 daily_email_limit at the cap", async () => {
    email = await useFakeEmail({ primary: { dailyCap: 1 } });
    await fillDailyCap(PRIMARY, 1, Date.now());
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/send`, {
      as: "member@studio.test",
      method: "POST",
      json: {},
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "daily_email_limit" });
    expect((await docRow(id))?.number).toBeNull();
  });

  it("returns 422 email_not_configured without a provider", async () => {
    await resetEmailState();
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/send`, {
      as: "member@studio.test",
      method: "POST",
      json: {},
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "email_not_configured" });
  });

  it("returns a needs-review error for an unclear send", async () => {
    email = await useFakeEmail({
      primary: {
        outcomes: [{ status: "unknown", reason: "network", message: "The connection dropped." }],
      },
    });
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/send`, {
      as: "member@studio.test",
      method: "POST",
      json: {},
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("email_needs_review");
    expect(body.error).toContain("Check the email provider logs");
  });

  it("POST /:id/mark-sent marks a draft sent without email", async () => {
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/mark-sent`, {
      as: "member@studio.test",
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await docRow(id))?.status).toBe("sent");
    expect(email.primary.sends).toHaveLength(0);
  });
});

describe("emailJobOutcome", () => {
  const notSent = (reason: string, extra: Record<string, number> = {}) =>
    new EmailSendError({
      status: "not_sent",
      reason: reason as never,
      message: "Refused.",
      provider: "tosend",
      ...extra,
    });

  it("fails the job at once for a permanent reason", () => {
    for (const reason of ["auth", "rejected", "invalid_message", "unsupported"]) {
      expect(emailJobOutcome(notSent(reason), NOW)).toEqual({
        fail: { message: `tosend not_sent/${reason}: Refused.` },
      });
    }
  });

  it("lets runJob retry a transient reason with its backoff", () => {
    for (const reason of ["network", "timeout", "provider_error", "store_error", "in_flight"]) {
      expect(emailJobOutcome(notSent(reason), NOW)).toBeNull();
    }
  });

  it("reschedules a cap or a limit at resetAt or after retryAfterMs", () => {
    expect(emailJobOutcome(notSent("daily_cap", { resetAt: NOW + 5000 }), NOW)).toEqual({
      defer: { runAfter: NOW + 5000, reason: "daily_cap" },
    });
    expect(emailJobOutcome(notSent("rate_limited", { retryAfterMs: 30_000 }), NOW)).toEqual({
      defer: { runAfter: NOW + 30_000, reason: "rate_limited" },
    });
    expect(emailJobOutcome(notSent("credits"), NOW)).toBeNull();
  });
});

describe("ownerEmails", () => {
  it("leaves out an invited Owner, who has not joined", async () => {
    await seedUser("owner@studio.test", "owner");
    await seedUser("invited@studio.test", "owner", { status: "invited" });
    await seedUser("member@studio.test", "member");
    expect(await ownerEmails(db)).toEqual(["owner@studio.test"]);
  });
});
