import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isBotUserAgent, QUOTE_DECISION_JOB, VIEW_WINDOW_MS } from "../../src/worker/routes/public";
import { finalize, markSent, voidDocument } from "../../src/worker/services/documents";
import { recordPayment } from "../../src/worker/services/payments";
import { clearUsers, seedUser } from "../helpers/auth";
import {
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  sentInvoice,
} from "../helpers/documents";

const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const LOGO_KEY = `logos/${"a".repeat(64)}.png`;

let clientId: string;
let ownerId: string;
let senderId: string;

function visit(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", BROWSER);
  return exports.default.fetch(new Request(`https://app.test${path}`, { ...init, headers }));
}

function decide(token: string, fields: Record<string, string>) {
  return visit(`/p/${token}/decision`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function tokenOf(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT public_token AS token FROM documents WHERE id = ?")
    .bind(id)
    .first<{ token: string }>();
  if (!row?.token) throw new Error("no token");
  return row.token;
}

async function statusOf(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM documents WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  return row?.status ?? "";
}

/** Moves a date on the document row and in its revision snapshots, like time passing. */
async function setDate(id: string, column: "due_date" | "expiry_date", value: string) {
  const path = column === "due_date" ? "$.document.dueDate" : "$.document.expiryDate";
  await env.DB.batch([
    env.DB.prepare(`UPDATE documents SET ${column} = ? WHERE id = ?`).bind(value, id),
    env.DB.prepare(
      "UPDATE document_revisions SET snapshot = json_set(snapshot, ?, ?) WHERE document_id = ?",
    ).bind(path, value, id),
  ]);
}

async function viewCount(id: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM activity WHERE document_id = ? AND type = 'viewed'",
  )
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** A sent quote. The sender is a Member, so the notification has two recipients. */
async function sentQuote(): Promise<{ id: string; token: string }> {
  const id = await draft({ kind: "quote", clientId });
  const { revision } = await finalize(db, id, { now: NOW, fetcher: noFetch });
  await markSent(db, id, {
    revisionId: revision.id,
    now: NOW,
    actor: { id: senderId, email: "sender@public.test", name: null, role: "member" },
  });
  return { id, token: await tokenOf(id) };
}

beforeAll(async () => {
  await clearUsers();
  ownerId = (await seedUser("owner@public.test", "owner")).id;
  senderId = (await seedUser("sender@public.test", "member")).id;
});

beforeEach(async () => {
  await resetDocuments();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("UPDATE workspace SET bank_details = 'City Bank 0042', logo_key = ?").bind(
      LOGO_KEY,
    ),
  ]);
  await env.BUCKET.put(LOGO_KEY, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  clientId = (await seedClient()).id;
});

describe("GET /p/:token", () => {
  it("renders the invoice with security headers, a PDF link, and bank details", async () => {
    const id = await sentInvoice({ clientId });
    const token = await tokenOf(id);
    const res = await visit(`/p/${token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("INV-0001");
    expect(html).toContain(`href="/p/${token}/pdf"`);
    expect(html).toContain("Pay by bank transfer");
    expect(html).toContain("City Bank 0042");

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("script-src");
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<style nonce="${nonce}">`);
  });

  it("references only /p/ assets, and each loads without a session", async () => {
    const token = await tokenOf(await sentInvoice({ clientId }));
    const html = await (await visit(`/p/${token}`)).text();
    const urls = [
      ...new Set(
        [...html.matchAll(/(?:src|href)="([^"]+)"|url\(([^)]+)\)/g)].map((m) => m[1] ?? m[2] ?? ""),
      ),
    ];
    expect(urls.length).toBeGreaterThan(4);
    for (const url of urls) {
      expect(url.startsWith("/p/")).toBe(true);
      if (url.endsWith("/pdf")) continue;
      const res = await visit(url);
      expect(res.status, url).toBe(200);
    }
  });

  it("returns a minimal 404 for an unknown token", async () => {
    const res = await visit("/p/not-a-token");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("This link does not work");
    expect(html).not.toContain("not-a-token");
  });

  it("records one view per hour and skips bots", async () => {
    const id = await sentInvoice({ clientId });
    const token = await tokenOf(id);
    await visit(`/p/${token}`);
    await visit(`/p/${token}`);
    expect(await viewCount(id)).toBe(1);

    await env.DB.prepare(
      "UPDATE activity SET created_at = created_at - ? WHERE document_id = ? AND type = 'viewed'",
    )
      .bind(VIEW_WINDOW_MS + 1000, id)
      .run();
    await visit(`/p/${token}`);
    expect(await viewCount(id)).toBe(2);
  });

  it("records no view for a Slackbot link preview", async () => {
    const id = await sentInvoice({ clientId });
    const token = await tokenOf(id);
    const res = await visit(`/p/${token}`, {
      headers: { "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" },
    });
    expect(res.status).toBe(200);
    expect(await viewCount(id)).toBe(0);
  });

  it("detects common bots and link previews", () => {
    for (const ua of [
      "facebookexternalhit/1.1",
      "Twitterbot/1.0",
      "LinkedInBot/1.0",
      "WhatsApp/2.23.20.0",
      "Mozilla/5.0 (compatible; Discordbot/2.0)",
      "TelegramBot (like TwitterBot)",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "Applebot/0.1",
      "curl/8.4.0",
      "Some link preview service",
      "MyCrawler 1.0",
      "",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
    expect(isBotUserAgent(BROWSER)).toBe(false);
  });

  it("shows paid, partially paid, overdue, and void states", async () => {
    const id = await sentInvoice({ clientId });
    const token = await tokenOf(id);

    await setDate(id, "due_date", "2026-01-15");
    let html = await (await visit(`/p/${token}`)).text();
    expect(html).toContain("<strong>Overdue</strong>");
    expect(html).toContain("This invoice was due on 15 Jan 2026.");

    await env.DB.prepare(
      "UPDATE documents SET status = 'partially_paid', amount_paid = 50000 WHERE id = ?",
    )
      .bind(id)
      .run();
    html = await (await visit(`/p/${token}`)).text();
    expect(html).toContain("Partially paid");
    expect(html).toContain("Paid BDT 500.00");
    expect(html).toContain("Balance due");
    expect(html).toContain("Pay by bank transfer");

    await env.DB.prepare("UPDATE documents SET status = 'sent', amount_paid = 0 WHERE id = ?")
      .bind(id)
      .run();
    await setDate(id, "due_date", "2099-01-01");
    await recordPayment(db, id, { amount: 200000, paidOn: "2026-10-23" }, { now: NOW });
    html = await (await visit(`/p/${token}`)).text();
    expect(html).toContain("<strong>Paid</strong>");
    expect(html).not.toContain("Pay by bank transfer");
    expect(html).not.toContain("City Bank 0042");

    const other = await sentInvoice({ clientId });
    await voidDocument(db, other, { now: NOW });
    html = await (await visit(`/p/${await tokenOf(other)}`)).text();
    expect(html).toContain("<strong>Void</strong>");
  });
});

describe("POST /p/:token/decision", () => {
  it("AE6: accepting a sent quote records the decision and queues a notification", async () => {
    // An Owner who has not joined yet is not a recipient.
    await seedUser("invited-owner@studio.test", "owner", { status: "invited" });
    const quote = await sentQuote();
    const page = await (await visit(`/p/${quote.token}`)).text();
    expect(page).toContain('value="accept"');
    expect(page).toContain(`action="/p/${quote.token}/decision"`);

    const res = await decide(quote.token, { decision: "accept", comment: "Looks <b>good</b>" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Thank you. You accepted this quote.");
    expect(html).toContain("Accepted on");
    expect(html).toContain("Looks &lt;b&gt;good&lt;/b&gt;");
    expect(html).not.toContain('value="accept"');
    expect(await statusOf(quote.id)).toBe("accepted");

    const job = await env.DB.prepare("SELECT type, payload FROM jobs WHERE type = ?")
      .bind(QUOTE_DECISION_JOB)
      .first<{ type: string; payload: string }>();
    const payload = JSON.parse(job?.payload ?? "{}") as {
      documentId: string;
      decision: string;
      recipientUserIds: string[];
    };
    expect(payload.documentId).toBe(quote.id);
    expect(payload.decision).toBe("accepted");
    expect(payload.recipientUserIds.sort()).toEqual([ownerId, senderId].sort());

    // A later visit shows the decision and no buttons.
    const later = await (await visit(`/p/${quote.token}`)).text();
    expect(later).toContain("Accepted on");
    expect(later).not.toContain('value="decline"');
  });

  it("shows a declined quote with its date and comment", async () => {
    const quote = await sentQuote();
    await decide(quote.token, { decision: "decline", comment: "Over budget" });
    const html = await (await visit(`/p/${quote.token}`)).text();
    expect(html).toMatch(/Declined on \d{1,2} [A-Z][a-z]{2} \d{4}/);
    expect(html).toContain("Over budget");
    expect(html).not.toContain('value="accept"');
  });

  it("rejects a second decision", async () => {
    const quote = await sentQuote();
    await decide(quote.token, { decision: "decline" });
    const res = await decide(quote.token, { decision: "accept" });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("already has a decision");
    expect(await statusOf(quote.id)).toBe("declined");
  });

  it("rejects accept after the expiry date and keeps the status", async () => {
    const quote = await sentQuote();
    await setDate(quote.id, "expiry_date", "2026-01-10");
    const page = await (await visit(`/p/${quote.token}`)).text();
    expect(page).toContain("This quote expired on 10 Jan 2026");
    expect(page).not.toContain('value="accept"');

    const res = await decide(quote.token, { decision: "accept" });
    expect(res.status).toBe(409);
    expect(await statusOf(quote.id)).toBe("sent");
    const jobs = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
    expect(jobs?.n).toBe(0);
  });

  it("rejects a comment over 1000 characters and a missing decision", async () => {
    const quote = await sentQuote();
    const long = await decide(quote.token, { decision: "accept", comment: "x".repeat(1001) });
    expect(long.status).toBe(400);
    expect(await long.text()).toContain("Use 1000 characters or fewer");
    const missing = await decide(quote.token, { comment: "hi" });
    expect(missing.status).toBe(400);
    expect(await statusOf(quote.id)).toBe("sent");
  });

  it("returns 404 for an invoice token or an unknown token", async () => {
    const token = await tokenOf(await sentInvoice({ clientId }));
    expect((await decide(token, { decision: "accept" })).status).toBe(404);
    expect((await decide("nope", { decision: "accept" })).status).toBe(404);
  });
});
