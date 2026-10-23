import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DashboardData, NotificationList } from "../../src/shared/schemas/dashboard";
import { schema } from "../../src/worker/db/client";
import { getDashboard } from "../../src/worker/services/dashboard";
import { finalize, voidDocument } from "../../src/worker/services/documents";
import { retryFailedJob } from "../../src/worker/services/jobs";
import { recordPayment } from "../../src/worker/services/payments";
import { createSchedule } from "../../src/worker/services/recurring";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import {
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  sentInvoice,
  TODAY,
} from "../helpers/documents";

const OWNER = "owner@dashboard.test";
const MEMBER = "member@dashboard.test";
let owner: Awaited<ReturnType<typeof seedUser>>;

beforeAll(async () => {
  installAccessKeys();
  await clearUsers();
  owner = await seedUser(OWNER, "owner");
  await seedUser(MEMBER, "member");
});

beforeEach(async () => {
  await resetDocuments();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notifications"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
});

function lines(unitPrice: number) {
  return [{ description: "Work", quantity: "1", unitPrice }];
}

/** Seeds USD, EUR, and GBP open invoices plus a draft, a void, and a finalized invoice. */
async function seedLedger() {
  const northwind = await seedClient({ name: "Northwind" });
  const halden = await seedClient({ name: "Halden & Co" });
  const moss = await seedClient({ name: "Moss Coffee" });
  const usdA = await sentInvoice({
    clientId: northwind.id,
    currency: "USD",
    lines: lines(200000),
    fxRate: { rate: "120", date: TODAY },
  });
  await recordPayment(db, usdA, { amount: 50000, paidOn: TODAY }, { now: NOW });
  await sentInvoice({
    clientId: northwind.id,
    currency: "USD",
    lines: lines(100000),
    fxRate: { rate: "121.5", date: TODAY },
  });
  // Overdue: due 2026-09-15.
  await sentInvoice({
    clientId: halden.id,
    currency: "EUR",
    lines: lines(300000),
    issueDate: "2026-09-01",
    paymentTermsDays: 14,
    fxRate: { rate: "130", date: "2026-09-01" },
  });
  await sentInvoice({
    clientId: moss.id,
    currency: "GBP",
    lines: lines(98000),
    fxRate: { rate: "150.25", date: TODAY },
  });
  // Excluded: a draft, a void invoice, and a finalized invoice that was never sent.
  await draft({ clientId: northwind.id, currency: "USD", lines: lines(999900) });
  const voided = await sentInvoice({
    clientId: northwind.id,
    currency: "USD",
    lines: lines(777700),
    fxRate: { rate: "120", date: TODAY },
  });
  await voidDocument(db, voided, { now: NOW });
  const ready = await draft({
    clientId: moss.id,
    currency: "GBP",
    lines: lines(555500),
    fxRate: { rate: "150", date: TODAY },
  });
  await finalize(db, ready, { now: NOW, fetcher: noFetch });
  return { usdA, northwind };
}

describe("dashboard aggregate", () => {
  it("sums each currency exactly and converts to BDT at each invoice's stored rate", async () => {
    await seedLedger();
    const data = await getDashboard(db, {}, { now: NOW });

    expect(data.homeCurrency).toBe("BDT");
    expect(data.today).toBe(TODAY);
    expect(data.isEmpty).toBe(false);
    expect(data.byCurrency).toEqual([
      { currency: "EUR", amount: 300000, home: 39000000, invoiceCount: 1 },
      // 1,500.00 x 120 + 1,000.00 x 121.5
      { currency: "USD", amount: 250000, home: 30150000, invoiceCount: 2 },
      { currency: "GBP", amount: 98000, home: 14724500, invoiceCount: 1 },
    ]);
    expect(data.outstanding).toEqual({ home: 83874500, invoiceCount: 4, currencyCount: 3 });
    expect(data.overdue).toEqual({ home: 39000000, invoiceCount: 1, topClientName: "Halden & Co" });
    expect(data.paidThisMonth).toEqual({ home: 6000000, paymentCount: 1, invoiceCount: 1 });
  });

  it("leaves void invoices, drafts, and finalized invoices out of outstanding", async () => {
    await seedLedger();
    const data = await getDashboard(db, {}, { now: NOW });
    const usd = data.byCurrency.find((row) => row.currency === "USD");
    expect(usd?.amount).toBe(250000);
    const gbp = data.byCurrency.find((row) => row.currency === "GBP");
    expect(gbp?.amount).toBe(98000);
    expect(data.readyToSend.count).toBe(1);
    expect(data.readyToSend.items[0]).toMatchObject({ currency: "GBP", total: 555500 });
  });

  it("filters the recent invoices and shows the next recurring invoice", async () => {
    const { usdA } = await seedLedger();
    const all = await getDashboard(db, {}, { now: NOW });
    expect(all.recent).toHaveLength(7);
    const overdue = await getDashboard(db, { recent: "overdue" }, { now: NOW });
    expect(overdue.recent.map((d) => d.clientName)).toEqual(["Halden & Co"]);
    const drafts = await getDashboard(db, { recent: "drafts" }, { now: NOW });
    expect(drafts.recent).toHaveLength(1);

    expect(all.nextRecurring).toBeNull();
    await createSchedule(
      db,
      { sourceDocumentId: usdA, frequency: "monthly", startDate: "2026-11-01", sendMode: "draft" },
      { actor: { id: owner.id, email: OWNER, name: null, role: "owner" }, now: NOW },
    );
    const withSchedule = await getDashboard(db, {}, { now: NOW });
    expect(withSchedule.nextRecurring).toMatchObject({
      nextIssueDate: "2026-11-01",
      clientName: "Northwind",
      currency: "USD",
      total: 200000,
    });
  });

  it("returns zeroes for an empty workspace", async () => {
    const res = await apiFetch("/api/dashboard", { as: MEMBER });
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardData;
    expect(data.isEmpty).toBe(true);
    expect(data.outstanding).toEqual({ home: 0, invoiceCount: 0, currencyCount: 0 });
    expect(data.overdue).toEqual({ home: 0, invoiceCount: 0, topClientName: null });
    expect(data.paidThisMonth).toEqual({ home: 0, paymentCount: 0, invoiceCount: 0 });
    expect(data.byCurrency).toEqual([]);
    expect(data.recent).toEqual([]);
    expect(data.needsReminder).toEqual([]);
    expect(data.nextRecurring).toBeNull();
    expect(data.readyToSend).toEqual({ count: 0, items: [] });
    expect(data.notifications).toEqual({ unreadCount: 0, items: [] });
    expect(data.failedJobs).toEqual({ count: 0, items: [] });
  });

  it("rejects an unknown recent filter", async () => {
    const res = await apiFetch("/api/dashboard?recent=nope", { as: MEMBER });
    expect(res.status).toBe(400);
  });
});

describe("notifications", () => {
  async function seedNotifications(count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({
      type: "recurring_draft_ready",
      title: `Notice ${i + 1}`,
      createdAt: NOW + i,
    }));
    return db.insert(schema.notifications).values(rows).returning();
  }

  it("shows the newest five open notifications and dismisses one", async () => {
    const rows = await seedNotifications(7);
    const data = await getDashboard(db, {}, { now: NOW });
    expect(data.notifications.unreadCount).toBe(7);
    expect(data.notifications.items.map((n) => n.title)).toEqual([
      "Notice 7",
      "Notice 6",
      "Notice 5",
      "Notice 4",
      "Notice 3",
    ]);

    const newest = rows[6];
    if (!newest) throw new Error("missing row");
    const res = await apiFetch(`/api/notifications/${newest.id}/dismiss`, {
      as: MEMBER,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const after = await getDashboard(db, {}, { now: NOW });
    expect(after.notifications.unreadCount).toBe(6);
    expect(after.notifications.items[0]?.title).toBe("Notice 6");

    const list = (await (
      await apiFetch("/api/notifications?state=all", { as: MEMBER })
    ).json()) as NotificationList;
    expect(list.total).toBe(7);
    expect(list.items[0]?.readAt).not.toBeNull();

    const missing = await apiFetch("/api/notifications/nope/dismiss", {
      as: MEMBER,
      method: "POST",
    });
    expect(missing.status).toBe(404);
  });

  it("dismisses all notifications", async () => {
    await seedNotifications(3);
    const res = await apiFetch("/api/notifications/dismiss-all", { as: MEMBER, method: "POST" });
    expect(await res.json()).toEqual({ dismissed: 3 });
    const data = await getDashboard(db, {}, { now: NOW });
    expect(data.notifications).toEqual({ unreadCount: 0, items: [] });
  });
});

describe("failed jobs", () => {
  async function seedFailedJob() {
    const [job] = await db
      .insert(schema.jobs)
      .values({
        type: "test_unregistered",
        payload: { documentId: "doc-1" },
        idempotencyKey: `test:${crypto.randomUUID()}`,
        status: "failed",
        attempts: 3,
        lastError: "boom",
        finishedAt: NOW,
      })
      .returning();
    if (!job) throw new Error("job insert failed");
    return job;
  }

  it("lists failed jobs on the dashboard", async () => {
    const job = await seedFailedJob();
    const data = await getDashboard(db, {}, { now: NOW });
    expect(data.failedJobs.count).toBe(1);
    expect(data.failedJobs.items[0]).toMatchObject({
      id: job.id,
      type: "test_unregistered",
      lastError: "boom",
      attempts: 3,
      documentId: "doc-1",
    });
  });

  it("lets only an Owner retry, and the retry resets the attempts", async () => {
    const job = await seedFailedJob();
    const denied = await apiFetch(`/api/jobs/${job.id}/retry`, { as: MEMBER, method: "POST" });
    expect(denied.status).toBe(403);

    const res = await apiFetch(`/api/jobs/${job.id}/retry`, { as: OWNER, method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: job.id, status: "pending" });

    const again = await apiFetch("/api/jobs/missing/retry", { as: OWNER, method: "POST" });
    expect(again.status).toBe(404);
  });

  it("puts the job back in the queue with zero attempts", async () => {
    const job = await seedFailedJob();
    const retried = await retryFailedJob(db, job.id, NOW + 1000);
    expect(retried).toMatchObject({
      status: "pending",
      attempts: 0,
      runAfter: NOW + 1000,
      finishedAt: null,
    });
  });

  it("refuses to retry a job that has not failed", async () => {
    const [job] = await db
      .insert(schema.jobs)
      .values({ type: "x", idempotencyKey: `test:${crypto.randomUUID()}`, status: "done" })
      .returning();
    const res = await apiFetch(`/api/jobs/${job?.id}/retry`, { as: OWNER, method: "POST" });
    expect(res.status).toBe(409);
  });
});
