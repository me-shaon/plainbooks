import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "../../src/worker/db/client";
import type { AuthUser } from "../../src/worker/env";
import { registerEmailJobHandlers, SEND_EMAIL_JOB } from "../../src/worker/services/email";
import { enqueue, TICK_QUERY_BUDGET } from "../../src/worker/services/jobs";
import { setPdfRendererForTesting } from "../../src/worker/services/pdf";
import {
  createSchedule,
  RECURRING_JOB,
  registerRecurringJobs,
  setRecurringFetcherForTesting,
} from "../../src/worker/services/recurring";
import { REMINDER_JOB, registerReminderJobs } from "../../src/worker/services/reminders";
import { runTick, TICK_INTERVAL_MS } from "../../src/worker/services/scheduler";
import { clearUsers, seedUser } from "../helpers/auth";
import { countingEnv } from "../helpers/d1";
import { db, draft, noFetch, resetDocuments, seedClient, sentInvoice } from "../helpers/documents";
import {
  type FakeEmail,
  fillDailyCap,
  resetEmailState,
  restoreEmail,
  useFakeEmail,
} from "../helpers/email";
import { resetPdfState, stubRenderer } from "../helpers/pdf";

/** 10:00 in Asia/Dhaka on `day`, a :00 tick. */
const at = (day: string) => Date.parse(`${day}T04:00:00Z`);
let owner: AuthUser;
let email: FakeEmail;

beforeAll(() => {
  registerEmailJobHandlers();
  registerRecurringJobs();
  registerReminderJobs();
});

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await clearUsers();
  await env.DB.prepare(
    `UPDATE workspace SET reminder_mode = 'suggest', overdue_reminder_cap = 3,
     reminder_schedule = '[{"offsetDays":0},{"offsetDays":7},{"offsetDays":14}]'`,
  ).run();
  const row = await seedUser("owner@studio.test", "owner");
  owner = { id: row.id, email: row.email, name: row.name, role: "owner" };
  setPdfRendererForTesting(stubRenderer());
  email = await useFakeEmail();
  setRecurringFetcherForTesting(noFetch);
});

afterEach(() => {
  setPdfRendererForTesting(null);
  restoreEmail();
  setRecurringFetcherForTesting(null);
});

async function jobsByType() {
  const rows = await db.select().from(schema.jobs);
  return new Map(rows.map((r) => [r.type, r]));
}

/**
 * Runs a recurring auto-send, an auto reminder, and three notes through eight ticks.
 * Returns the providers that sent, in order of the fakes.
 */
async function runBudgetScenario(): Promise<string[]> {
  const client = await seedClient({ recurringSendMode: "auto_send", reminderMode: "auto_send" });
  // A recurring auto-send period due Nov 2.
  const source = await draft({ clientId: client.id });
  await createSchedule(
    db,
    { sourceDocumentId: source, frequency: "monthly", startDate: "2026-11-02" },
    { actor: owner, now: at("2026-10-01") },
  );
  // An invoice due Oct 26, so the +7 reminder is due Nov 2.
  await sentInvoice({ clientId: client.id, issueDate: "2026-10-12" }, at("2026-10-12"));
  // Three light jobs.
  for (let i = 0; i < 3; i++) {
    await enqueue(
      db,
      {
        type: SEND_EMAIL_JOB,
        idempotencyKey: `note:${i}`,
        payload: { to: ["owner@studio.test"], subject: `Note ${i}`, html: "<p>x</p>", text: "x" },
      },
      at("2026-11-02"),
    );
  }

  const { env: counted, counter } = countingEnv();
  const start = at("2026-11-02");
  const perTick: number[] = [];
  for (let i = 0; i < 8; i++) {
    counter.reset();
    const summary = await runTick(counted, start + i * TICK_INTERVAL_MS);
    perTick.push(counter.statements);
    expect(summary.errors).toBe(0);
    expect(counter.statements).toBeLessThan(TICK_QUERY_BUDGET);

    if (i === 0) {
      // The :00 tick runs the enqueue phase and light jobs only. The heavy jobs stay
      // pending and keep all their attempts.
      expect(summary.mode).toBe("normal");
      const jobs = await jobsByType();
      for (const type of [RECURRING_JOB, REMINDER_JOB]) {
        expect(jobs.get(type)).toMatchObject({ status: "pending", attempts: 0 });
      }
    }
  }
  console.log(`statements per tick: ${perTick.join(", ")}`);

  const rows = await db.select().from(schema.jobs);
  expect(rows.every((r) => r.status === "done")).toBe(true);
  expect(rows.every((r) => r.attempts === 1)).toBe(true);
  // The invoice email, the reminder, and the three notes went out.
  const sends = [...email.primary.sends, ...(email.fallback?.sends ?? [])].filter(
    (send) => send.result.status === "sent",
  );
  const subjects = sends.map((c) => c.message.subject);
  expect(subjects.filter((s) => s.startsWith("Note"))).toHaveLength(3);
  expect(subjects.filter((s) => !s.startsWith("Note")).sort()).toEqual([
    "Invoice INV-0002 from Studio One",
    "Overdue: invoice INV-0001 from Studio One",
  ]);
  return sends.map((send) => send.result.provider ?? "");
}

describe("tick query budget with the real handlers", () => {
  it("keeps every tick under 50 D1 queries and claims only jobs it runs", async () => {
    expect(await runBudgetScenario()).toEqual(Array(5).fill("tosend"));
  });

  it("stays under 50 when every email falls back from a capped primary to a capped fallback", async () => {
    // Every email goes out through the capped fallback. A document send skips the full
    // primary after its cap check. A note has no cap check, so the mailer first refuses
    // the primary reservation, then reserves on the fallback.
    email = await useFakeEmail({
      primary: { providerId: "resend" },
      fallback: { providerId: "tosend", dailyCap: 50 },
    });
    await fillDailyCap({ providerId: "resend", role: "primary" }, 100, at("2026-11-02"));
    expect(await runBudgetScenario()).toEqual(Array(5).fill("tosend"));
    expect(email.primary.sends).toHaveLength(0);
  });
});
