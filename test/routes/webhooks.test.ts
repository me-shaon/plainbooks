import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifySvixSignature } from "../../src/worker/routes/webhooks";
import {
  registerEmailJobHandlers,
  SEND_EMAIL_JOB,
  sendDocument,
  setResendFetchForTesting,
} from "../../src/worker/services/email";
import { setPdfRendererForTesting } from "../../src/worker/services/pdf";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import {
  activityTypes,
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
} from "../helpers/documents";
import { resetEmailState, stubResend } from "../helpers/email";
import { resetPdfState, stubRenderer } from "../helpers/pdf";

const SECRET = env.RESEND_WEBHOOK_SECRET;

async function sign(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const raw = atob(secret.slice("whsec_".length));
  const keyBytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
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
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

async function postWebhook(
  event: unknown,
  opts: { id?: string; timestamp?: number; signature?: string | null } = {},
) {
  const body = JSON.stringify(event);
  const id = opts.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
  };
  const signature =
    opts.signature === undefined ? await sign(SECRET, id, timestamp, body) : opts.signature;
  if (signature !== null) headers["svix-signature"] = signature;
  return apiFetch("/api/webhooks/resend", { method: "POST", headers, body });
}

const bounce = (emailId: string) => ({
  type: "email.bounced",
  created_at: "2026-10-23T06:00:00.000Z",
  data: {
    email_id: emailId,
    to: ["ap@northwind.test"],
    subject: "Invoice INV-0001 from Studio One",
    bounce: { message: "Mailbox does not exist", type: "Permanent" },
  },
});

let docId: string;

beforeAll(() => {
  installAccessKeys();
  registerEmailJobHandlers();
});

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await clearUsers();
  await seedUser("owner@studio.test", "owner");
  setPdfRendererForTesting(stubRenderer());
  setResendFetchForTesting(stubResend(() => Response.json({ id: "re_123" })));
  const clientId = (await seedClient()).id;
  docId = await draft({ clientId });
  await sendDocument(env, db, docId, { now: NOW, fetcher: noFetch });
});

afterEach(() => {
  setPdfRendererForTesting(null);
  setResendFetchForTesting(null);
});

describe("verifySvixSignature", () => {
  it("accepts any matching v1 entry and rejects stale timestamps", async () => {
    const now = 1_800_000_000_000;
    const ts = now / 1000;
    const good = await sign(SECRET, "msg_1", ts, "{}");
    const headers = { id: "msg_1", timestamp: String(ts), signature: `v1,bogus ${good}` };
    expect(await verifySvixSignature(SECRET, headers, "{}", now)).toBe(true);
    expect(await verifySvixSignature(SECRET, headers, "{ }", now)).toBe(false);
    expect(await verifySvixSignature(SECRET, headers, "{}", now + 6 * 60 * 1000)).toBe(false);
    expect(await verifySvixSignature(SECRET, headers, "{}", now - 4 * 60 * 1000)).toBe(true);
    expect(
      await verifySvixSignature(
        SECRET,
        { ...headers, signature: good.replace("v1,", "v2,") },
        "{}",
        now,
      ),
    ).toBe(false);
  });
});

describe("POST /api/webhooks/resend", () => {
  it("records a signed bounce: activity, notification, log status, and an owner email job", async () => {
    const res = await postWebhook(bounce("re_123"), { id: "msg_bounce_1" });
    expect(res.status).toBe(200);
    expect(await activityTypes(docId)).toContain("email_bounced");

    const notes = await env.DB.prepare("SELECT type, document_id FROM notifications").all();
    expect(notes.results).toEqual([{ type: "email_bounced", document_id: docId }]);
    const log = await env.DB.prepare(
      "SELECT status FROM email_log WHERE provider_id = 're_123'",
    ).first<{
      status: string;
    }>();
    expect(log?.status).toBe("bounced");

    const job = await env.DB.prepare("SELECT type, payload FROM jobs WHERE idempotency_key = ?")
      .bind("email_bounced:msg_bounce_1")
      .first<{ type: string; payload: string }>();
    expect(job?.type).toBe(SEND_EMAIL_JOB);
    const payload = JSON.parse(job?.payload ?? "{}") as {
      to: string[];
      subject: string;
      html: string;
    };
    expect(payload.to).toEqual(["owner@studio.test"]);
    expect(payload.subject).toBe("Email bounced for INV-0001");
    expect(payload.html).toContain("Mailbox does not exist");

    // A replay of the same message changes nothing.
    await postWebhook(bounce("re_123"), { id: "msg_bounce_1" });
    const count = await env.DB.prepare("SELECT count(*) AS n FROM notifications").first<{
      n: number;
    }>();
    expect(count?.n).toBe(1);
    expect((await activityTypes(docId)).filter((t) => t === "email_bounced")).toHaveLength(1);
  });

  it("a bounce on an owner notification records it but emails nobody", async () => {
    await env.DB.prepare(
      `INSERT INTO email_log (id, day, kind, trigger, document_id, recipients, subject, status, provider_id, created_at)
       VALUES ('owner-note', '2026-10-23', 'notification', 'auto', ?, '["owner@studio.test"]', 'Email bounced', 'sent', 're_owner', 0)`,
    )
      .bind(docId)
      .run();
    const res = await postWebhook(bounce("re_owner"), { id: "msg_owner_1" });
    expect(res.status).toBe(200);

    const log = await env.DB.prepare("SELECT status FROM email_log WHERE id = 'owner-note'").first<{
      status: string;
    }>();
    expect(log?.status).toBe("bounced");
    const notes = await env.DB.prepare("SELECT type FROM notifications").all();
    expect(notes.results).toEqual([{ type: "email_bounced" }]);
    expect(await activityTypes(docId)).not.toContain("email_bounced");
    const job = await env.DB.prepare("SELECT payload FROM jobs WHERE idempotency_key = ?")
      .bind("email_bounced:msg_owner_1")
      .first<{ payload: string }>();
    expect((JSON.parse(job?.payload ?? "{}") as { to: string[] }).to).toEqual([]);

    // A replay is still a no-op.
    await postWebhook(bounce("re_owner"), { id: "msg_owner_1" });
    const count = await env.DB.prepare("SELECT count(*) AS n FROM notifications").first<{
      n: number;
    }>();
    expect(count?.n).toBe(1);
  });

  it("records a complaint", async () => {
    const res = await postWebhook({ ...bounce("re_123"), type: "email.complained" });
    expect(res.status).toBe(200);
    expect(await activityTypes(docId)).toContain("email_complained");
  });

  it("rejects unsigned, badly signed, and stale requests", async () => {
    expect((await postWebhook(bounce("re_123"), { signature: null })).status).toBe(400);
    expect((await postWebhook(bounce("re_123"), { signature: "v1,AAAA" })).status).toBe(400);
    const stale = Math.floor(Date.now() / 1000) - 10 * 60;
    expect((await postWebhook(bounce("re_123"), { timestamp: stale })).status).toBe(400);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM notifications").first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });

  it("ignores other event types with 200", async () => {
    const res = await postWebhook({ type: "email.delivered", data: { email_id: "re_123" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    const count = await env.DB.prepare("SELECT count(*) AS n FROM notifications").first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });
});
