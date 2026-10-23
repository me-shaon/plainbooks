import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documentUpdateInput } from "../../src/shared/schemas/document";
import { todayIn } from "../../src/shared/time";
import { schema } from "../../src/worker/db/client";
import { QUOTE_DECISION_JOB } from "../../src/worker/routes/public";
import { decideQuote, revise, voidDocument } from "../../src/worker/services/documents";
import {
  DAILY_EMAIL_LIMIT,
  defaultRecipients,
  markSentManually,
  nextEmailWindow,
  registerEmailJobHandlers,
  SEND_DOCUMENT_JOB,
  SEND_EMAIL_JOB,
  sendDocument,
  setResendFetchForTesting,
} from "../../src/worker/services/email";
import { enqueue, runJobById } from "../../src/worker/services/jobs";
import { setPdfRendererForTesting } from "../../src/worker/services/pdf";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
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
import { fillEmailLog, resetEmailState, stubResend } from "../helpers/email";
import { failingRenderer, resetPdfState, stubRenderer } from "../helpers/pdf";

let clientId: string;
let renderer: ReturnType<typeof stubRenderer>;
let resend: ReturnType<typeof stubResend>;

async function docRow(id: string) {
  return env.DB.prepare("SELECT status, number, public_token AS token FROM documents WHERE id = ?")
    .bind(id)
    .first<{ status: string; number: string | null; token: string }>();
}

beforeAll(() => {
  installAccessKeys();
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
  resend = stubResend();
  setResendFetchForTesting(resend);
});

afterEach(() => {
  setPdfRendererForTesting(null);
  setResendFetchForTesting(null);
});

describe("sendDocument", () => {
  it("finalizes a draft, attaches the PDF, calls Resend once, and marks it sent", async () => {
    const id = await draft({ clientId });
    const result = await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });

    expect(result.document.status).toBe("sent");
    expect(result.emailId).toBe("email-1");
    expect(resend.calls).toHaveLength(1);
    const call = resend.calls[0];
    if (!call) throw new Error("no call");
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.headers.get("authorization")).toBe("Bearer re_test_key");
    expect(call.body.from).toBe('"Studio One" <billing@studio.test>');
    expect(call.body.reply_to).toBe("hello@studio.test");
    expect(call.body.to).toEqual(["ap@northwind.test", "billing@northwind.test"]);
    expect(call.body.subject).toBe("Invoice INV-0001 from Studio One");
    expect(call.body.attachments).toEqual([
      { filename: "INV-0001.pdf", content: btoa("%PDF-1.7 test") },
    ]);
    const token = (await docRow(id))?.token;
    expect(call.body.html).toContain(`https://invoices.example.com/p/${token}`);
    expect(call.body.text).toContain(`https://invoices.example.com/p/${token}`);
    expect(await activityTypes(id)).toEqual(["created", "finalized", "sent"]);

    const log = await env.DB.prepare("SELECT status, provider_id, kind, day FROM email_log").all();
    expect(log.results).toEqual([
      { status: "sent", provider_id: "email-1", kind: "document", day: TODAY },
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
    const body = resend.calls[0]?.body;
    expect(body?.to).toEqual(["cfo@northwind.test"]);
    expect(body?.subject).toBe("Your October invoice");
    expect(body?.html).toContain("Thanks &lt;b&gt;a lot&lt;/b&gt;");
    expect(body?.html).not.toContain("<b>a lot</b>");
  });

  it("keeps the number in finalized after a Resend 422, and a retry reuses it", async () => {
    resend = stubResend((_, i) =>
      i === 0
        ? Response.json(
            { statusCode: 422, message: "Invalid `to` field", name: "validation_error" },
            { status: 422 },
          )
        : Response.json({ id: "email-ok" }),
    );
    setResendFetchForTesting(resend);
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 422,
      code: "email_rejected",
    });
    expect(await docRow(id)).toMatchObject({ status: "finalized", number: "INV-0001" });
    expect(await activityTypes(id)).toEqual(["created", "finalized", "send_failed"]);

    const retry = await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    expect(retry.document).toMatchObject({ status: "sent", number: "INV-0001" });
    expect(await counterValue("invoice")).toBe(1);
    // The cached PDF is reused on the retry.
    expect(renderer.calls).toHaveLength(1);
  });

  it("maps a Resend 5xx to 502 email_send_failed", async () => {
    setResendFetchForTesting(stubResend(() => new Response("oops", { status: 503 })));
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 502,
      code: "email_send_failed",
    });
  });

  it("blocks the send when the PDF fails, and never calls Resend", async () => {
    setPdfRendererForTesting(failingRenderer());
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 502,
      code: "pdf_render_failed",
    });
    expect(resend.calls).toHaveLength(0);
    expect((await docRow(id))?.status).toBe("finalized");
    expect(await activityTypes(id)).toContain("send_failed");
  });

  it("returns 429 at the daily limit before using a number", async () => {
    await fillEmailLog(TODAY, DAILY_EMAIL_LIMIT);
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      status: 429,
      code: "daily_email_limit",
    });
    expect(await docRow(id)).toMatchObject({ status: "draft", number: null });
    expect(resend.calls).toHaveLength(0);
  });

  it("does not count failed attempts toward the limit", async () => {
    await fillEmailLog(TODAY, DAILY_EMAIL_LIMIT - 1);
    await env.DB.prepare(
      "UPDATE email_log SET status = 'failed' WHERE id = 'fill-2026-10-23-0'",
    ).run();
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).resolves.toBeTruthy();
  });

  it("requires a sender address", async () => {
    await env.DB.prepare("UPDATE workspace SET email_from_address = NULL").run();
    const id = await draft({ clientId });
    await expect(sendDocument(env, db, id, { now: NOW, fetcher: noFetch })).rejects.toMatchObject({
      code: "email_not_configured",
    });
    expect((await docRow(id))?.number).toBeNull();
  });

  it("uses the updated-invoice email for a revised invoice", async () => {
    const id = await draft({ clientId });
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    await revise(db, id, documentUpdateInput.parse({ notes: "Fixed" }), {
      now: NOW,
      fetcher: noFetch,
    });
    await env.DB.prepare("DELETE FROM leases").run();
    await sendDocument(env, db, id, { now: NOW, fetcher: noFetch });
    expect(resend.calls[1]?.body.subject).toBe("Updated invoice INV-0001 from Studio One");
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
    expect(resend.calls).toHaveLength(0);
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
  it("send_document defers to 00:05 Dhaka tomorrow at the daily limit", async () => {
    await fillEmailLog(TODAY, DAILY_EMAIL_LIMIT);
    const id = await draft({ clientId });
    const job = await enqueue(
      db,
      { type: SEND_DOCUMENT_JOB, payload: { documentId: id }, idempotencyKey: `auto:${id}` },
      NOW,
    );
    expect(await runJobById(env, job.id, NOW)).toBe("deferred");
    const row = await env.DB.prepare("SELECT status, run_after, attempts FROM jobs WHERE id = ?")
      .bind(job.id)
      .first<{ status: string; run_after: number; attempts: number }>();
    // 2026-10-24 00:05 in Asia/Dhaka is 2026-10-23 18:05 UTC.
    expect(row).toEqual({
      status: "pending",
      run_after: Date.UTC(2026, 9, 23, 18, 5),
      attempts: 0,
    });
    expect(nextEmailWindow({ timezone: "Asia/Dhaka" }, NOW)).toBe(Date.UTC(2026, 9, 23, 18, 5));
    expect(resend.calls).toHaveLength(0);
  });

  it("send_document sends with trigger auto and an idempotency key", async () => {
    const id = await draft({ clientId });
    const job = await enqueue(
      db,
      { type: SEND_DOCUMENT_JOB, payload: { documentId: id }, idempotencyKey: `auto:${id}` },
      NOW,
    );
    expect(await runJobById(env, job.id, NOW)).toBe("done");
    expect(resend.calls[0]?.headers.get("idempotency-key")).toBe(`job:${job.id}`);
    expect((await docRow(id))?.status).toBe("sent");
    const log = await env.DB.prepare("SELECT trigger FROM email_log").first<{ trigger: string }>();
    expect(log?.trigger).toBe("auto");
  });

  it("send_email retries when Resend fails", async () => {
    setResendFetchForTesting(stubResend(() => new Response("{}", { status: 500 })));
    const job = await enqueue(
      db,
      {
        type: SEND_EMAIL_JOB,
        payload: { to: ["owner@studio.test"], subject: "Hi", html: "<p>Hi</p>", text: "Hi" },
        idempotencyKey: "generic-1",
      },
      NOW,
    );
    expect(await runJobById(env, job.id, NOW)).toBe("retry");
  });

  it("notify_quote_decision emails the sender and every Owner with the comment escaped", async () => {
    const owner = await seedUser("owner@studio.test", "owner");
    const owner2 = await seedUser("owner2@studio.test", "owner");
    const sender = await seedUser("sender@studio.test", "member");
    await seedUser("bystander@studio.test", "member");
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
          recipientUserIds: [sender.id, owner.id, owner2.id],
        },
        idempotencyKey: `${QUOTE_DECISION_JOB}:${id}`,
      },
      NOW,
    );
    expect(await runJobById(env, job.id, NOW)).toBe("done");

    const email = resend.calls[1]?.body;
    expect(email?.to.sort()).toEqual(
      ["owner2@studio.test", "owner@studio.test", "sender@studio.test"].sort(),
    );
    expect(email?.subject).toBe("Northwind accepted quote Q-0001");
    expect(email?.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; thanks");
    expect(email?.html).not.toContain("<script>");
    expect(email?.html).toContain(`https://invoices.example.com/quotes/${id}`);

    const notes = await env.DB.prepare("SELECT type, document_id FROM notifications").all();
    expect(notes.results).toEqual([{ type: "quote_decision", document_id: id }]);
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
    expect(body.emailId).toBe("email-1");
  });

  it("validates recipients", async () => {
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/send`, {
      as: "member@studio.test",
      method: "POST",
      json: { recipients: ["not-an-email"] },
    });
    expect(res.status).toBe(400);
    expect(resend.calls).toHaveLength(0);
  });

  it("returns 429 daily_email_limit at the cap", async () => {
    await fillEmailLog(todayIn("Asia/Dhaka", Date.now()), DAILY_EMAIL_LIMIT);
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/send`, {
      as: "member@studio.test",
      method: "POST",
      json: {},
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "daily_email_limit" });
  });

  it("POST /:id/mark-sent marks a draft sent without email", async () => {
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/mark-sent`, {
      as: "member@studio.test",
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await docRow(id))?.status).toBe("sent");
    expect(resend.calls).toHaveLength(0);
  });
});
