import { env } from "cloudflare:workers";
import { createSnsSigner, type SnsMessage } from "mailswitch/conformance";
import { postmarkWebhookAuthorization } from "mailswitch/postmark";
import { svixSignedPayload } from "mailswitch/resend";
import { toSendSignature } from "mailswitch/tosend";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailProviderRole } from "../../src/shared/domain";
import { app } from "../../src/worker/app";
import { saveEmailProvider } from "../../src/worker/email/settings";
import { WEBHOOK_MAX_BODY_BYTES } from "../../src/worker/routes/webhooks";
import {
  registerEmailJobHandlers,
  SEND_EMAIL_JOB,
  sendDocument,
} from "../../src/worker/services/email";
import { setPdfRendererForTesting } from "../../src/worker/services/pdf";
import { apiFetch, buildRequest, clearUsers, seedUser } from "../helpers/auth";
import { countingEnv } from "../helpers/d1";
import {
  activityTypes,
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
} from "../helpers/documents";
import { resetEmailState, restoreEmail, useFakeEmail } from "../helpers/email";
import { resetPdfState, stubRenderer } from "../helpers/pdf";

const TOSEND_SECRET = "tosend-webhook-secret-0123456789";
const RESEND_SECRET = `whsec_${btoa("resend-webhook-secret-0123456789")}`;
const POSTMARK_SECRET = "postmark-webhook-password-0123456789";
const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:ses-events";
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-plainbooks.pem";
const SUBSCRIBE_URL =
  "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:123456789012:ses-events&Token=abc";

const CREDENTIALS: Record<string, Record<string, string>> = {
  tosend: { apiKey: "tsend_test_key" },
  resend: { apiKey: "re_test_key" },
  postmark: { serverToken: "POSTMARK_API_TEST" },
  ses: { region: "us-east-1", accessKeyId: "AKIAEXAMPLEKEY000001", secretAccessKey: "secret" },
};

/** Saves a provider for a role with a webhook secret. */
async function saveProvider(
  role: EmailProviderRole,
  providerId: string,
  webhookSecret: string | null,
): Promise<void> {
  await saveEmailProvider(db, env.ENCRYPTION_KEY, role, {
    providerId,
    credentials: CREDENTIALS[providerId] ?? {},
    webhookSecret,
  });
}

const encoder = new TextEncoder();

/** Posts a raw body to a role's webhook URL. */
function post(role: string, body: string | Uint8Array, headers: Record<string, string> = {}) {
  return apiFetch(`/api/webhooks/email/${role}`, { method: "POST", headers, body });
}

async function tosendPost(role: string, event: unknown, secret = TOSEND_SECRET) {
  const body = JSON.stringify(event);
  const signature = await toSendSignature(secret, encoder.encode(body));
  return post(role, body, { "content-type": "application/json", "x-tosend-signature": signature });
}

async function resendPost(role: string, event: unknown, id = `msg_${crypto.randomUUID()}`) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = atob(RESEND_SECRET.slice("whsec_".length));
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(raw, (ch) => ch.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    svixSignedPayload(id, timestamp, encoder.encode(body)),
  );
  return post(role, body, {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`,
  });
}

function postmarkPost(role: string, event: unknown, secret = POSTMARK_SECRET) {
  return post(role, JSON.stringify(event), {
    authorization: postmarkWebhookAuthorization(secret),
  });
}

const tosendBounce = (messageId: string) => ({
  type: "bounced",
  created_at: "2026-10-23T06:00:00.000Z",
  data: {
    message_id: messageId,
    email: "ap@northwind.test",
    is_hard_bounce: true,
  },
});

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function logStatus(messageId: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT status FROM email_log WHERE provider_id = ?")
    .bind(messageId)
    .first<{ status: string }>();
  return row?.status;
}

/** Inserts a sent email_log row for the document. */
async function insertLog(
  messageId: string,
  emailProvider: string,
  kind: "document" | "notification" = "document",
) {
  await env.DB.prepare(
    `INSERT INTO email_log (id, day, kind, trigger, document_id, recipients, subject, status, provider_id, email_provider, created_at)
     VALUES (?, '2026-10-23', ?, 'auto', ?, '["ap@northwind.test"]', 'Invoice INV-0001 from Studio One', 'sent', ?, ?, 0)`,
  )
    .bind(crypto.randomUUID(), kind, docId, messageId, emailProvider)
    .run();
}

let docId: string;

beforeAll(() => {
  registerEmailJobHandlers();
});

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await clearUsers();
  await seedUser("owner@studio.test", "owner");
  setPdfRendererForTesting(stubRenderer());
  await useFakeEmail({ primary: { outcomes: [{ status: "sent", providerMessageId: "ts_123" }] } });
  const clientId = (await seedClient()).id;
  docId = await draft({ clientId });
  await sendDocument(env, db, docId, { now: NOW, fetcher: noFetch });
  // The send used the fake. The webhook path uses the real toSend adapter and this secret.
  await saveProvider("primary", "tosend", TOSEND_SECRET);
});

afterEach(() => {
  setPdfRendererForTesting(null);
  restoreEmail();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/email/:role with toSend", () => {
  it("records a signed bounce: activity, notification, log status, and an owner email job", async () => {
    const res = await tosendPost("primary", tosendBounce("ts_123"));
    expect(res.status).toBe(200);
    expect(await activityTypes(docId)).toContain("email_bounced");
    expect(await logStatus("ts_123")).toBe("bounced");

    const notes = await env.DB.prepare("SELECT type, body, document_id FROM notifications").all();
    expect(notes.results).toEqual([
      {
        type: "email_bounced",
        body: "To ap@northwind.test: Invoice INV-0001 from Studio One",
        document_id: docId,
      },
    ]);
    const job = await env.DB.prepare(
      "SELECT type, payload, idempotency_key FROM jobs WHERE idempotency_key LIKE 'email_bounced:%'",
    ).first<{ type: string; payload: string; idempotency_key: string }>();
    expect(job?.type).toBe(SEND_EMAIL_JOB);
    expect(job?.idempotency_key).toMatch(/^email_bounced:tosend:primary:[0-9a-f]{64}$/);
    const payload = JSON.parse(job?.payload ?? "{}") as { to: string[]; subject: string };
    expect(payload.to).toEqual(["owner@studio.test"]);
    expect(payload.subject).toBe("Email bounced for INV-0001");
  });

  it("writes a replayed event once and answers 200 both times", async () => {
    const event = tosendBounce("ts_123");
    expect((await tosendPost("primary", event)).status).toBe(200);
    expect((await tosendPost("primary", event)).status).toBe(200);
    expect(await count("notifications")).toBe(1);
    expect(await count("jobs WHERE type = 'send_email'")).toBe(1);
    expect((await activityTypes(docId)).filter((t) => t === "email_bounced")).toHaveLength(1);
    const dedupe = await env.DB.prepare(
      "SELECT key, committed FROM mailswitch_webhook_dedupe",
    ).all<{ key: string; committed: number }>();
    expect(dedupe.results).toHaveLength(1);
    expect(dedupe.results[0]?.key).toMatch(/^tosend:primary:/);
    expect(dedupe.results[0]?.committed).toBe(1);
  });

  it("refuses a bad signature with 401 and writes nothing", async () => {
    const res = await tosendPost("primary", tosendBounce("ts_123"), "another-secret-0123456789");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature", code: "invalid_signature" });
    const unsigned = await post("primary", JSON.stringify(tosendBounce("ts_123")));
    expect(unsigned.status).toBe(401);
    expect(await count("notifications")).toBe(0);
    expect(await count("mailswitch_webhook_dedupe")).toBe(0);
    expect(await logStatus("ts_123")).toBe("sent");
  });

  it("does not email the owners again for a bounce on an owner notification", async () => {
    await insertLog("ts_owner", "tosend", "notification");
    const res = await tosendPost("primary", tosendBounce("ts_owner"));
    expect(res.status).toBe(200);
    expect(await logStatus("ts_owner")).toBe("bounced");
    const notes = await env.DB.prepare("SELECT type FROM notifications").all();
    expect(notes.results).toEqual([{ type: "email_bounced" }]);
    expect(await activityTypes(docId)).not.toContain("email_bounced");
    const job = await env.DB.prepare(
      "SELECT payload FROM jobs WHERE idempotency_key LIKE 'email_bounced:%'",
    ).first<{ payload: string }>();
    expect((JSON.parse(job?.payload ?? "{}") as { to: string[] }).to).toEqual([]);
  });

  it("ignores delivered events and events with no message ID, with 200", async () => {
    const delivered = { type: "delivered", data: { message_id: "ts_123", email: "a@b.test" } };
    expect((await tosendPost("primary", delivered)).status).toBe(200);
    const noId = { type: "bounced", data: { email: "ap@northwind.test" } };
    expect((await tosendPost("primary", noId)).status).toBe(200);
    expect(await count("notifications")).toBe(0);
    expect(await logStatus("ts_123")).toBe("sent");
  });

  it("ignores a log row of another provider with the same message ID", async () => {
    await env.DB.prepare("UPDATE email_log SET email_provider = 'resend'").run();
    expect((await tosendPost("primary", tosendBounce("ts_123"))).status).toBe(200);
    expect(await logStatus("ts_123")).toBe("sent");
    // The Owner still gets the in-app notification.
    expect(await count("notifications")).toBe(1);
  });

  it("releases the events and answers 500 when a write fails, so a retry records them", async () => {
    const failing = {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, prop) {
          if (prop === "batch") return () => Promise.reject(new Error("D1 is down"));
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    const body = JSON.stringify(tosendBounce("ts_123"));
    const headers = {
      "x-tosend-signature": await toSendSignature(TOSEND_SECRET, encoder.encode(body)),
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await app.fetch(
      await buildRequest("/api/webhooks/email/primary", { method: "POST", headers, body }),
      failing,
    );
    expect(failed.status).toBe(500);
    expect(await count("mailswitch_webhook_dedupe")).toBe(0);
    expect(await count("notifications")).toBe(0);

    const retry = await post("primary", body, headers);
    expect(retry.status).toBe(200);
    expect(await count("notifications")).toBe(1);
    expect(await logStatus("ts_123")).toBe("bounced");
  });
});

describe("POST /api/webhooks/email/:role with Resend and Postmark", () => {
  it("records a signed Resend complaint", async () => {
    await saveProvider("primary", "resend", RESEND_SECRET);
    await insertLog("re_456", "resend");
    const res = await resendPost("primary", {
      type: "email.complained",
      created_at: "2026-10-23T06:00:00.000Z",
      data: { email_id: "re_456", to: ["ap@northwind.test"], subject: "Invoice" },
    });
    expect(res.status).toBe(200);
    expect(await activityTypes(docId)).toContain("email_complained");
    expect(await logStatus("re_456")).toBe("complained");
  });

  it("refuses a stale Resend signature with the same 401", async () => {
    await saveProvider("primary", "resend", RESEND_SECRET);
    const res = await post("primary", "{}", {
      "svix-id": "msg_1",
      "svix-timestamp": String(Math.floor(Date.now() / 1000) - 10 * 60),
      "svix-signature": "v1,AAAA",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature", code: "invalid_signature" });
  });

  it("records a Postmark bounce on the fallback webhook URL", async () => {
    await saveProvider("fallback", "postmark", POSTMARK_SECRET);
    await insertLog("pm-789", "postmark");
    const event = {
      RecordType: "Bounce",
      ID: 4323372036,
      Type: "HardBounce",
      MessageID: "pm-789",
      Email: "ap@northwind.test",
      BouncedAt: "2026-10-23T06:00:00Z",
    };
    expect((await postmarkPost("fallback", event)).status).toBe(200);
    expect(await logStatus("pm-789")).toBe("bounced");
    const job = await env.DB.prepare(
      "SELECT idempotency_key FROM jobs WHERE idempotency_key LIKE 'email_bounced:%'",
    ).first<{ idempotency_key: string }>();
    expect(job?.idempotency_key).toBe("email_bounced:postmark:fallback:Bounce:4323372036");
    // The primary is toSend, so a Postmark request on the primary URL fails its check.
    expect((await postmarkPost("primary", event)).status).toBe(401);
    expect((await postmarkPost("fallback", event, "wrong-password-0123456789")).status).toBe(401);
  });

  it("answers 401 when the saved Postmark password is too short for mailswitch", async () => {
    await saveProvider("fallback", "postmark", "short");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await postmarkPost("fallback", { RecordType: "Bounce" }, "short");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/webhooks/email/:role refusals", () => {
  it("gives the same 401 for an unconfigured role, an unknown role, and no webhook secret", async () => {
    const expected = { error: "Invalid signature", code: "invalid_signature" };
    const fallback = await tosendPost("fallback", tosendBounce("ts_123"));
    expect(fallback.status).toBe(401);
    expect(await fallback.json()).toEqual(expected);
    const unknown = await tosendPost("other", tosendBounce("ts_123"));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(expected);

    await saveProvider("primary", "tosend", null);
    const noSecret = await tosendPost("primary", tosendBounce("ts_123"));
    expect(noSecret.status).toBe(401);
    expect(await noSecret.json()).toEqual(expected);
    expect(await count("notifications")).toBe(0);
  });

  it("gives 401 for a provider with no webhooks", async () => {
    await saveEmailProvider(db, env.ENCRYPTION_KEY, "primary", {
      providerId: "zeptomail",
      credentials: { token: "Zoho-enczapikey abcdefgh12" },
      webhookSecret: "a-secret-value-0123456789",
    });
    const res = await tosendPost("primary", tosendBounce("ts_123"));
    expect(res.status).toBe(401);
  });

  it("refuses a 300 KB body with 413 before it reads or decrypts the settings", async () => {
    const big = encoder.encode(JSON.stringify({ type: "bounced", pad: "x".repeat(300 * 1024) }));
    expect(big.byteLength).toBeGreaterThan(WEBHOOK_MAX_BODY_BYTES);
    const { env: counted, counter } = countingEnv();
    const send = async (body: BodyInit) =>
      app.fetch(
        await buildRequest("/api/webhooks/email/primary", {
          method: "POST",
          headers: { "x-tosend-signature": await toSendSignature(TOSEND_SECRET, big) },
          body,
        }),
        counted,
      );
    const res = await send(big);
    expect(res.status).toBe(413);
    // A streamed body has no content-length. The route counts the bytes as it reads.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < big.byteLength; i += 64 * 1024) {
          controller.enqueue(big.slice(i, i + 64 * 1024));
        }
        controller.close();
      },
    });
    expect((await send(stream)).status).toBe(413);
    // No D1 statement ran, so the provider row was never read or decrypted.
    expect(counter.statements).toBe(0);
  });
});

const signer = await createSnsSigner();

describe("POST /api/webhooks/email/:role with Amazon SES", () => {
  function sesFetch(subscribeStatus = 200) {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url === CERT_URL) return new Response(signer.certificatePem);
      if (url === SUBSCRIBE_URL) return new Response("<ok/>", { status: subscribeStatus });
      return new Response("not found", { status: 404 });
    });
    return calls;
  }

  async function sesPost(message: Omit<SnsMessage, "Signature" | "SignatureVersion">) {
    const signed = await signer.sign({ ...message, SignatureVersion: "2" });
    return post("primary", JSON.stringify(signed), {
      "x-amz-sns-message-type": message.Type,
    });
  }

  const confirmation = (id: string) => ({
    Type: "SubscriptionConfirmation" as const,
    MessageId: id,
    TopicArn: TOPIC_ARN,
    Message: "You have chosen to subscribe to the topic.",
    Timestamp: new Date().toISOString(),
    SigningCertURL: CERT_URL,
    SubscribeURL: SUBSCRIBE_URL,
    Token: "abc",
  });

  beforeEach(async () => {
    await saveProvider("primary", "ses", TOPIC_ARN);
  });

  it("confirms a subscription with one GET and an activity row", async () => {
    const calls = sesFetch();
    const message = confirmation("sns-confirm-1");
    expect((await sesPost(message)).status).toBe(200);
    expect(calls.filter((url) => url === SUBSCRIBE_URL)).toHaveLength(1);
    const rows = await env.DB.prepare(
      "SELECT document_id, data FROM activity WHERE type = 'email_webhook_confirmed'",
    ).all<{ document_id: string | null; data: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.document_id).toBeNull();
    expect(JSON.parse(rows.results[0]?.data ?? "{}")).toEqual({
      provider: "ses",
      role: "primary",
      topicArn: TOPIC_ARN,
    });

    // A replay of the same message is a duplicate: no second GET.
    expect((await sesPost(message)).status).toBe(200);
    expect(calls.filter((url) => url === SUBSCRIBE_URL)).toHaveLength(1);
  });

  it("answers 500 and releases the event when the subscribe GET fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sesFetch(503);
    const message = confirmation("sns-confirm-2");
    expect((await sesPost(message)).status).toBe(500);
    expect(await count("activity WHERE type = 'email_webhook_confirmed'")).toBe(0);
    vi.mocked(globalThis.fetch).mockRestore();

    const calls = sesFetch();
    expect((await sesPost(message)).status).toBe(200);
    expect(calls.filter((url) => url === SUBSCRIBE_URL)).toHaveLength(1);
  });

  it("refuses a topic that is not on the allowlist with the same 401", async () => {
    const calls = sesFetch();
    const res = await sesPost({
      ...confirmation("sns-confirm-3"),
      TopicArn: "arn:aws:sns:us-east-1:123456789012:other-topic",
    });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("records an SES bounce of two recipients as one notice", async () => {
    sesFetch();
    await insertLog("ses-msg-1", "ses");
    const res = await sesPost({
      Type: "Notification",
      MessageId: "sns-bounce-1",
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify({
        eventType: "Bounce",
        mail: { messageId: "ses-msg-1" },
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "a@northwind.test" }, { emailAddress: "b@x.test" }],
        },
      }),
      Timestamp: new Date().toISOString(),
      SigningCertURL: CERT_URL,
    });
    expect(res.status).toBe(200);
    expect(await logStatus("ses-msg-1")).toBe("bounced");
    const notes = await env.DB.prepare("SELECT body FROM notifications").all<{ body: string }>();
    expect(notes.results).toEqual([
      { body: "To a@northwind.test, b@x.test: Invoice INV-0001 from Studio One" },
    ]);
  });
});
