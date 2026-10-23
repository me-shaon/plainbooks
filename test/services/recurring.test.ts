import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  duePeriods,
  isoWeek,
  nextIssueDateFrom,
  occurrenceDate,
  type PeriodRule,
  periodId,
} from "../../src/shared/recurring";
import { schema } from "../../src/worker/db/client";
import type { AuthUser } from "../../src/worker/env";
import {
  registerEmailJobHandlers,
  setResendFetchForTesting,
} from "../../src/worker/services/email";
import type { Fetcher } from "../../src/worker/services/fx";
import { setPdfRendererForTesting } from "../../src/worker/services/pdf";
import {
  createSchedule,
  registerRecurringJobs,
  resolveSendMode,
  setRecurringFetcherForTesting,
  updateSchedule,
} from "../../src/worker/services/recurring";
import { runTick } from "../../src/worker/services/scheduler";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import { db, draft, noFetch, resetDocuments, seedClient } from "../helpers/documents";
import { resetEmailState, stubResend } from "../helpers/email";
import { resetPdfState, stubRenderer } from "../helpers/pdf";

/** 10:00 in Asia/Dhaka on `day`. */
const at = (day: string) => Date.parse(`${day}T04:00:00Z`);

let owner: AuthUser;
let resend: ReturnType<typeof stubResend>;

async function scheduleFor(
  clientId: string,
  input: {
    frequency?: "weekly" | "monthly" | "quarterly" | "yearly";
    startDate: string;
    endDate?: string | null;
    sendMode?: "inherit" | "draft" | "auto_send";
  },
  now = at("2026-10-01"),
) {
  const sourceDocumentId = await draft({ clientId });
  return createSchedule(
    db,
    { sourceDocumentId, frequency: input.frequency ?? "monthly", ...input },
    { actor: owner, now },
  );
}

async function invoicesOf(scheduleId: string) {
  return db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.recurringScheduleId, scheduleId))
    .orderBy(schema.documents.issueDate);
}

async function notificationTypes() {
  const rows = await db.select().from(schema.notifications);
  return rows.map((r) => r.type).sort();
}

async function jobKeys() {
  const rows = await db.select().from(schema.jobs).orderBy(schema.jobs.idempotencyKey);
  return rows.map((r) => r.idempotencyKey);
}

beforeAll(() => {
  installAccessKeys();
  registerEmailJobHandlers();
  registerRecurringJobs();
});

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await clearUsers();
  await env.DB.prepare("UPDATE workspace SET recurring_send_mode = 'draft'").run();
  const row = await seedUser("owner@studio.test", "owner");
  owner = { id: row.id, email: row.email, name: row.name, role: "owner" };
  setPdfRendererForTesting(stubRenderer());
  resend = stubResend();
  setResendFetchForTesting(resend);
  setRecurringFetcherForTesting(noFetch);
});

afterEach(() => {
  setPdfRendererForTesting(null);
  setResendFetchForTesting(null);
  setRecurringFetcherForTesting(null);
});

describe("period math", () => {
  const monthly = (startDate: string): PeriodRule => ({
    frequency: "monthly",
    startDate,
    anchorDay: Number(startDate.slice(8)),
  });

  it("anchors Jan 31 to the month end: Feb 28, then Mar 31", () => {
    const rule = monthly("2027-01-31");
    expect([0, 1, 2, 3].map((i) => occurrenceDate(rule, i))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("uses Feb 29 in a leap year", () => {
    const rule = monthly("2028-01-31");
    expect(occurrenceDate(rule, 1)).toBe("2028-02-29");
    expect(occurrenceDate(rule, 2)).toBe("2028-03-31");
  });

  it("falls back for a Feb 29 yearly anchor and steps quarters and weeks", () => {
    const yearly: PeriodRule = { frequency: "yearly", startDate: "2028-02-29", anchorDay: 29 };
    expect(occurrenceDate(yearly, 1)).toBe("2029-02-28");
    expect(occurrenceDate(yearly, 4)).toBe("2032-02-29");
    const quarterly: PeriodRule = {
      frequency: "quarterly",
      startDate: "2026-11-30",
      anchorDay: 30,
    };
    expect(occurrenceDate(quarterly, 1)).toBe("2027-02-28");
    expect(occurrenceDate(quarterly, 2)).toBe("2027-05-30");
    const weekly: PeriodRule = { frequency: "weekly", startDate: "2026-12-28", anchorDay: 28 };
    expect(occurrenceDate(weekly, 1)).toBe("2027-01-04");
  });

  it("names billing periods", () => {
    expect(periodId("weekly", "2026-10-23")).toBe("2026-W43");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(periodId("monthly", "2026-10-23")).toBe("2026-10");
    expect(periodId("quarterly", "2026-10-23")).toBe("2026-Q4");
    expect(periodId("yearly", "2026-10-23")).toBe("2026");
  });

  it("lists due periods up to today and the end date", () => {
    const rule = { ...monthly("2026-07-15"), endDate: "2026-09-30" };
    expect(duePeriods(rule, "2026-07-15", "2026-10-23")).toEqual([
      { issueDate: "2026-07-15", periodId: "2026-07" },
      { issueDate: "2026-08-15", periodId: "2026-08" },
      { issueDate: "2026-09-15", periodId: "2026-09" },
    ]);
  });

  it("skips the period that already has an invoice after an edit", () => {
    expect(nextIssueDateFrom(monthly("2026-10-25"), "2026-10-24", "2026-10")).toBe("2026-11-25");
    expect(nextIssueDateFrom(monthly("2026-10-25"), "2026-10-24", null)).toBe("2026-10-25");
  });

  it("resolves the send mode: schedule, then client, then workspace", () => {
    expect(resolveSendMode("inherit", "inherit", "draft")).toBe("draft");
    expect(resolveSendMode("inherit", "auto_send", "draft")).toBe("auto_send");
    expect(resolveSendMode("draft", "auto_send", "auto_send")).toBe("draft");
  });
});

describe("recurring_issue", () => {
  it("AE1: a client on auto-send gets the invoice created and emailed, with no review notice", async () => {
    const client = await seedClient({ recurringSendMode: "auto_send" });
    const id = await scheduleFor(client.id, { startDate: "2026-10-23" });

    const summary = await runTick(env, at("2026-10-23"));
    expect(summary.done).toBe(1);

    const [invoice] = await invoicesOf(id);
    expect(invoice?.status).toBe("sent");
    expect(invoice?.issueDate).toBe("2026-10-23");
    expect(invoice?.dueDate).toBe("2026-11-06");
    expect(invoice?.recurringPeriodId).toBe("2026-10");
    expect(resend.calls).toHaveLength(1);
    expect(resend.calls[0]?.body.to).toEqual(["ap@northwind.test"]);
    expect(resend.calls[0]?.body.attachments).toHaveLength(1);
    expect(await notificationTypes()).toEqual([]);
    expect(await jobKeys()).toEqual([`recurring:${id}:2026-10`]);

    const [schedule] = await db
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, id));
    expect(schedule?.nextIssueDate).toBe("2026-11-23");
    expect(schedule?.lastPeriodId).toBe("2026-10");
  });

  it("AE2: with the workspace default draft, it creates a draft and notifies the owner only", async () => {
    const client = await seedClient();
    const id = await scheduleFor(client.id, { startDate: "2026-10-23" });

    await runTick(env, at("2026-10-23"));
    const [invoice] = await invoicesOf(id);
    expect(invoice?.status).toBe("draft");
    expect(invoice?.number).toBeNull();
    expect(invoice?.paymentTermsDays).toBe(14);
    expect(await notificationTypes()).toEqual(["recurring_draft_ready"]);
    expect(resend.calls).toHaveLength(0);

    // The owner email goes out on the next tick. The client gets nothing.
    await runTick(env, at("2026-10-23") + 60_000);
    expect(resend.calls).toHaveLength(1);
    expect(resend.calls[0]?.body.to).toEqual(["owner@studio.test"]);
    expect(resend.calls[0]?.body.subject).toContain("Recurring invoice draft ready");
  });

  it("catches up on missed periods, and a repeated tick creates no duplicate", async () => {
    const client = await seedClient();
    const id = await scheduleFor(client.id, { startDate: "2026-08-23" });

    await runTick(env, at("2026-10-23"));
    await runTick(env, at("2026-10-23") + 15 * 60_000);
    await runTick(env, at("2026-10-23") + 30 * 60_000);

    const invoices = await invoicesOf(id);
    expect(invoices.map((d) => d.issueDate)).toEqual(["2026-08-23", "2026-09-23", "2026-10-23"]);
    expect(invoices.map((d) => d.recurringPeriodId)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("an edit to the start date in the same month does not create a second invoice", async () => {
    const client = await seedClient();
    const id = await scheduleFor(client.id, { startDate: "2026-10-01" });
    await runTick(env, at("2026-10-01"));
    await updateSchedule(
      db,
      id,
      { startDate: "2026-10-25" },
      { actor: owner, now: at("2026-10-24") },
    );
    await runTick(env, at("2026-10-25"));
    await runTick(env, at("2026-11-25"));
    const invoices = await invoicesOf(id);
    expect(invoices.map((d) => d.issueDate)).toEqual(["2026-10-01", "2026-11-25"]);
  });

  it("creates nothing for a schedule past its end date, and marks it ended", async () => {
    const client = await seedClient();
    const id = await scheduleFor(client.id, { startDate: "2026-08-01", endDate: "2026-08-31" });
    await db
      .update(schema.recurringSchedules)
      .set({ nextIssueDate: "2026-09-01", lastPeriodId: "2026-08" })
      .where(eq(schema.recurringSchedules.id, id));

    await runTick(env, at("2026-10-23"));
    expect(await invoicesOf(id)).toHaveLength(0);
    const [schedule] = await db
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, id));
    expect(schedule?.status).toBe("ended");
  });

  it("creates nothing for a paused schedule (client archived)", async () => {
    const client = await seedClient();
    const id = await scheduleFor(client.id, { startDate: "2026-10-23" });
    const res = await apiFetch(`/api/clients/${client.id}/archive`, {
      as: "owner@studio.test",
      method: "POST",
    });
    expect(res.status).toBeLessThan(300);

    await runTick(env, at("2026-10-23"));
    expect(await invoicesOf(id)).toHaveLength(0);
    const [schedule] = await db
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, id));
    expect(schedule?.status).toBe("paused");
    expect(schedule?.pausedReason).toBe("client_archived");
  });

  it("an auto-send period whose FX fetch fails stays a draft and notifies the owner", async () => {
    const client = await seedClient({ defaultCurrency: "EUR", recurringSendMode: "auto_send" });
    const failing: Fetcher = async () => new Response("down", { status: 503 });
    setRecurringFetcherForTesting(failing);
    const sourceDocumentId = await draft({ clientId: client.id, currency: "EUR" });
    const id = await createSchedule(
      db,
      { sourceDocumentId, frequency: "monthly", startDate: "2026-10-23" },
      { actor: owner, now: at("2026-10-01") },
    );

    await runTick(env, at("2026-10-23"));
    const [invoice] = await invoicesOf(id);
    expect(invoice?.status).toBe("draft");
    expect(invoice?.number).toBeNull();
    expect(await notificationTypes()).toEqual(["fx_rate_needed"]);
    expect(resend.calls).toHaveLength(0);
    expect(await jobKeys()).toContain(`fx_rate_needed:${invoice?.id}`);
  });

  it("an auto-send period at the daily email cap waits for tomorrow", async () => {
    const client = await seedClient({ recurringSendMode: "auto_send" });
    const id = await scheduleFor(client.id, { startDate: "2026-10-23" });
    const { fillEmailLog } = await import("../helpers/email");
    await fillEmailLog("2026-10-23", 100);

    const summary = await runTick(env, at("2026-10-23"));
    expect(summary.deferred).toBe(1);
    expect(await invoicesOf(id)).toHaveLength(0);
  });

  it("produces the right drafts across a simulated 3-month clock", async () => {
    const client = await seedClient();
    const id = await scheduleFor(client.id, { startDate: "2027-01-31" }, at("2027-01-01"));

    // A tick every 6 hours from Jan 30 to Apr 2.
    for (let t = at("2027-01-30"); t <= at("2027-04-02"); t += 6 * 60 * 60 * 1000) {
      await runTick(env, t);
    }
    const invoices = await invoicesOf(id);
    expect(invoices.map((d) => [d.issueDate, d.status, d.recurringPeriodId])).toEqual([
      ["2027-01-31", "draft", "2027-01"],
      ["2027-02-28", "draft", "2027-02"],
      ["2027-03-31", "draft", "2027-03"],
    ]);
    const notices = await db.select().from(schema.notifications);
    expect(notices.filter((n) => n.type === "recurring_draft_ready")).toHaveLength(3);
  });
});

describe("recurring routes", () => {
  it("lets an Owner create a schedule from an invoice and lists it", async () => {
    const client = await seedClient();
    const sourceDocumentId = await draft({ clientId: client.id });
    const res = await apiFetch("/api/recurring", {
      as: "owner@studio.test",
      method: "POST",
      json: {
        sourceDocumentId,
        frequency: "monthly",
        startDate: "2027-01-31",
        sendMode: "auto_send",
      },
    });
    expect(res.status).toBe(201);
    const detail = (await res.json()) as {
      id: string;
      nextIssueDate: string;
      lines: unknown[];
      upcoming: string[];
      resolvedSendMode: string;
    };
    expect(detail.nextIssueDate).toBe("2027-01-31");
    expect(detail.upcoming).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(detail.lines).toHaveLength(1);
    expect(detail.resolvedSendMode).toBe("auto_send");

    const list = (await (await apiFetch("/api/recurring", { as: "owner@studio.test" })).json()) as {
      items: { id: string; total: number }[];
    };
    expect(list.items.map((s) => s.id)).toEqual([detail.id]);
    expect(list.items[0]?.total).toBe(200000);
  });

  it("returns 403 when a Member sets auto-send on a schedule", async () => {
    await seedUser("member@studio.test", "member");
    const client = await seedClient();
    const sourceDocumentId = await draft({ clientId: client.id });
    const create = await apiFetch("/api/recurring", {
      as: "member@studio.test",
      method: "POST",
      json: {
        sourceDocumentId,
        frequency: "monthly",
        startDate: "2027-01-01",
        sendMode: "auto_send",
      },
    });
    expect(create.status).toBe(403);

    const ok = await apiFetch("/api/recurring", {
      as: "member@studio.test",
      method: "POST",
      json: { sourceDocumentId, frequency: "monthly", startDate: "2027-01-01" },
    });
    expect(ok.status).toBe(201);
    const { id } = (await ok.json()) as { id: string };
    const patch = await apiFetch(`/api/recurring/${id}`, {
      as: "member@studio.test",
      method: "PATCH",
      json: { sendMode: "auto_send" },
    });
    expect(patch.status).toBe(403);
    const lines = await apiFetch(`/api/recurring/${id}`, {
      as: "member@studio.test",
      method: "PATCH",
      json: { lines: [{ description: "Retainer", quantity: "2", unitPrice: 5000 }] },
    });
    expect(lines.status).toBe(200);
    expect(((await lines.json()) as { total: number }).total).toBe(10000);
  });

  it("pauses and resumes, skipping the periods missed while paused", async () => {
    const client = await seedClient();
    const id = await scheduleFor(client.id, { startDate: "2026-08-01" });
    const pause = await apiFetch(`/api/recurring/${id}/pause`, {
      as: "owner@studio.test",
      method: "POST",
    });
    expect(((await pause.json()) as { status: string }).status).toBe("paused");
    const resume = await apiFetch(`/api/recurring/${id}/resume`, {
      as: "owner@studio.test",
      method: "POST",
    });
    const body = (await resume.json()) as { status: string; nextIssueDate: string };
    expect(body.status).toBe("active");
    expect(body.nextIssueDate > "2026-10-01").toBe(true);
  });
});
