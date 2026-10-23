import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReminderSuggestion } from "../../src/shared/schemas/reminder";
import { addDays, todayIn } from "../../src/shared/time";
import { schema } from "../../src/worker/db/client";
import {
  registerEmailJobHandlers,
  setResendFetchForTesting,
} from "../../src/worker/services/email";
import { recordPayment } from "../../src/worker/services/payments";
import { pdfKey } from "../../src/worker/services/pdf";
import {
  dueStep,
  listSuggestions,
  REMINDER_JOB,
  registerReminderJobs,
  resolveMode,
  sendReminder,
} from "../../src/worker/services/reminders";
import { runTick } from "../../src/worker/services/scheduler";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import { activityTypes, db, resetDocuments, seedClient, sentInvoice } from "../helpers/documents";
import { resetEmailState, stubResend } from "../helpers/email";
import { resetPdfState } from "../helpers/pdf";

/** 10:00 in Asia/Dhaka on `day`. */
const at = (day: string) => Date.parse(`${day}T04:00:00Z`);
const DUE = "2026-10-26";
/** `days` from the due date, at 10:00 Dhaka. */
const offset = (days: number) => at(addDays(DUE, days));

let resend: ReturnType<typeof stubResend>;

/** An invoice issued Oct 12 and due Oct 26 (14-day terms). */
async function invoice(
  clientId: string,
  reminderMode: "inherit" | "suggest" | "auto_send" | "off" = "inherit",
) {
  return sentInvoice({ clientId, issueDate: "2026-10-12", reminderMode }, at("2026-10-12"));
}

async function reminderRows(documentId: string) {
  return db
    .select()
    .from(schema.emailLog)
    .where(eq(schema.emailLog.documentId, documentId))
    .orderBy(schema.emailLog.createdAt);
}

async function reminderJobs() {
  const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.type, REMINDER_JOB));
  return rows.map((r) => r.idempotencyKey).sort();
}

const ids = (items: ReminderSuggestion[]) => items.map((s) => s.documentId);

beforeAll(() => {
  installAccessKeys();
  registerEmailJobHandlers();
  registerReminderJobs();
});

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await clearUsers();
  await env.DB.prepare(
    `UPDATE workspace SET reminder_mode = 'suggest', overdue_reminder_cap = 3,
     reminder_schedule = '[{"offsetDays":-3},{"offsetDays":0},{"offsetDays":7},{"offsetDays":14},{"offsetDays":21}]'`,
  ).run();
  await seedUser("owner@studio.test", "owner");
  await seedUser("member@studio.test", "member");
  resend = stubResend();
  setResendFetchForTesting(resend);
});

afterEach(() => {
  setResendFetchForTesting(null);
});

describe("rules", () => {
  it("resolveMode: off on the invoice or the client wins, then invoice, client, workspace", () => {
    expect(resolveMode("off", "auto_send", "suggest")).toBe("off");
    expect(resolveMode("auto_send", "off", "suggest")).toBe("off");
    expect(resolveMode("suggest", "auto_send", "off")).toBe("suggest");
    expect(resolveMode("inherit", "auto_send", "suggest")).toBe("auto_send");
    expect(resolveMode("inherit", "inherit", "off")).toBe("off");
  });

  it("dueStep: the latest started step, once, with the cap on overdue steps only", () => {
    const base = {
      steps: [-3, 0, 7, 14, 21],
      lastSentOffset: null,
      sentOffset: -14,
      overdueSent: 0,
      cap: 3,
    };
    expect(dueStep({ ...base, offsetDays: -4 })).toBeNull();
    expect(dueStep({ ...base, offsetDays: -3 })).toBe(-3);
    expect(dueStep({ ...base, offsetDays: -1, lastSentOffset: -3 })).toBeNull();
    expect(dueStep({ ...base, offsetDays: 9, lastSentOffset: 0 })).toBe(7);
    expect(dueStep({ ...base, offsetDays: 30, overdueSent: 3 })).toBeNull();
    // A step on or before the send day is skipped: the invoice email covers it.
    expect(dueStep({ ...base, offsetDays: 0, sentOffset: 0 })).toBeNull();
  });
});

describe("suggestions and manual reminders", () => {
  it("AE3: a client on auto-send with an invoice set to off sends nothing and shows nothing", async () => {
    const client = await seedClient({ reminderMode: "auto_send" });
    const id = await invoice(client.id, "off");

    await runTick(env, offset(7));
    await runTick(env, offset(7) + 15 * 60_000);
    expect(await reminderJobs()).toEqual([]);
    expect(resend.calls).toHaveLength(0);
    expect(ids(await listSuggestions(db, offset(7)))).not.toContain(id);

    const res = await apiFetch(`/api/documents/${id}/remind`, {
      as: "owner@studio.test",
      method: "POST",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("reminders_off");
  });

  it("suggests a reminder 3 days before due, and a manual send logs it and counts", async () => {
    const client = await seedClient();
    const id = await invoice(client.id);

    expect(ids(await listSuggestions(db, offset(-4)))).toEqual([]);
    const [suggestion] = await listSuggestions(db, offset(-3));
    expect(suggestion).toMatchObject({
      documentId: id,
      stepOffsetDays: -3,
      offsetDays: -3,
      balance: 200000,
      overdueSent: 0,
      overdueCap: 3,
    });

    await sendReminder(env, db, id, { now: offset(-3), trigger: "manual" });
    expect(resend.calls).toHaveLength(1);
    expect(resend.calls[0]?.body.subject).toContain("Reminder: invoice INV-0001");
    expect(resend.calls[0]?.body.text).toContain("/p/");
    expect(resend.calls[0]?.body.attachments).toBeUndefined();
    const [row] = await reminderRows(id);
    expect(row).toMatchObject({ kind: "reminder", trigger: "manual", reminderOffsetDays: -3 });
    expect(await activityTypes(id)).toContain("reminder_sent");
    expect(ids(await listSuggestions(db, offset(-3)))).toEqual([]);

    // Overdue manual reminders count toward the cap.
    await sendReminder(env, db, id, { now: offset(2), trigger: "manual" });
    const [later] = await listSuggestions(db, offset(7));
    expect(later?.overdueSent).toBe(1);
  });

  it("attaches the PDF when it is already cached", async () => {
    const client = await seedClient();
    const id = await invoice(client.id);
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    await env.BUCKET.put(pdfKey(doc?.currentRevisionId ?? ""), new Uint8Array([37, 80, 68, 70]));
    await sendReminder(env, db, id, { now: offset(0), trigger: "manual" });
    expect(resend.calls[0]?.body.attachments).toEqual([
      { filename: "INV-0001.pdf", content: "JVBERg==" },
    ]);
  });

  it("stops after 3 overdue reminders, any mix of manual and automatic", async () => {
    await env.DB.prepare(
      `UPDATE workspace SET reminder_schedule = '[{"offsetDays":0},{"offsetDays":7},{"offsetDays":14},{"offsetDays":21},{"offsetDays":28}]'`,
    ).run();
    const client = await seedClient({ reminderMode: "auto_send" });
    const id = await invoice(client.id);

    await sendReminder(env, db, id, { now: offset(7), trigger: "manual" });
    await runTick(env, offset(7));
    await runTick(env, offset(14));
    await runTick(env, offset(21));
    await runTick(env, offset(28));
    await runTick(env, offset(35));

    const rows = await reminderRows(id);
    expect(rows.map((r) => [r.trigger, r.reminderOffsetDays])).toEqual([
      ["manual", 7],
      ["auto", 14],
      ["auto", 21],
    ]);
    expect(await reminderJobs()).toEqual([`reminder:${id}:14`, `reminder:${id}:21`]);
    expect(await listSuggestions(db, offset(35))).toEqual([]);
    await expect(
      sendReminder(env, db, id, { now: offset(35), trigger: "manual" }),
    ).rejects.toMatchObject({ status: 409, code: "reminder_cap_reached" });
  });

  it("a partially paid overdue invoice still gets reminders, and a paid one drops out", async () => {
    const client = await seedClient();
    const id = await invoice(client.id);
    await recordPayment(db, id, { amount: 50000, paidOn: "2026-10-20" }, { now: offset(-6) });

    const [suggestion] = await listSuggestions(db, offset(7));
    expect(suggestion).toMatchObject({
      documentId: id,
      displayStatus: "overdue",
      balance: 150000,
      stepOffsetDays: 7,
    });

    await recordPayment(db, id, { amount: 150000, paidOn: "2026-11-02" }, { now: offset(7) });
    expect(await listSuggestions(db, offset(7))).toEqual([]);
  });

  it("a repeated scheduler run does not resend the same step", async () => {
    const client = await seedClient();
    const id = await invoice(client.id, "inherit");
    await env.DB.prepare("UPDATE workspace SET reminder_mode = 'auto_send'").run();

    await runTick(env, offset(7));
    await runTick(env, offset(7) + 15 * 60_000);
    await runTick(env, offset(8));
    expect(resend.calls).toHaveLength(1);
    expect(await reminderJobs()).toEqual([`reminder:${id}:7`]);
    const [row] = await reminderRows(id);
    expect(row?.trigger).toBe("auto");
    expect(await activityTypes(id)).toContain("reminder_sent");
  });
});

describe("reminder routes", () => {
  it("lists suggestions, sends one, and returns the panel status", async () => {
    const client = await seedClient();
    const id = await invoice(client.id);
    // The route uses the real clock, so move the due date to today.
    const today = todayIn("Asia/Dhaka", Date.now());
    await db.update(schema.documents).set({ dueDate: today }).where(eq(schema.documents.id, id));

    const list = await apiFetch("/api/reminders/suggestions", { as: "member@studio.test" });
    const body = (await list.json()) as { items: ReminderSuggestion[] };
    expect(ids(body.items)).toContain(id);

    const sent = await apiFetch(`/api/documents/${id}/remind`, {
      as: "member@studio.test",
      method: "POST",
    });
    expect(sent.status).toBe(200);
    const result = (await sent.json()) as { status: { history: unknown[]; mode: string } };
    expect(result.status.history).toHaveLength(1);
    expect(result.status.mode).toBe("suggest");
  });

  it("lets only an Owner set auto-send on an invoice, and lets a Member turn it off", async () => {
    const client = await seedClient();
    const id = await invoice(client.id);
    const member = await apiFetch(`/api/documents/${id}/reminder-mode`, {
      as: "member@studio.test",
      method: "PATCH",
      json: { reminderMode: "auto_send" },
    });
    expect(member.status).toBe(403);
    const off = await apiFetch(`/api/documents/${id}/reminder-mode`, {
      as: "member@studio.test",
      method: "PATCH",
      json: { reminderMode: "off" },
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { reminderMode: string }).reminderMode).toBe("off");
    const owner = await apiFetch(`/api/documents/${id}/reminder-mode`, {
      as: "owner@studio.test",
      method: "PATCH",
      json: { reminderMode: "auto_send" },
    });
    expect(owner.status).toBe(200);
  });
});
