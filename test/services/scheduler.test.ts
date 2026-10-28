import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, schema } from "../../src/worker/db/client";
import worker from "../../src/worker/index";
import {
  claimJobs,
  enqueue,
  enqueueStatement,
  JOB_LEASE_MS,
  type JobHandler,
  registerEnqueueHook,
  registerJobHandler,
  resetJobRegistryForTesting,
  retryDelayMs,
  runJobSoon,
} from "../../src/worker/services/jobs";
import { runTick } from "../../src/worker/services/scheduler";
import { countingEnv } from "../helpers/d1";

const db = createDb(env.DB);
const NOW = Date.parse("2026-10-23T04:00:00Z"); // 10:00 in Dhaka
const MIN = 60 * 1000;

async function jobRows() {
  return db.select().from(schema.jobs).orderBy(schema.jobs.idempotencyKey);
}

async function jobByKey(key: string) {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, key));
  if (!job) throw new Error(`job ${key} not found`);
  return job;
}

async function seedJobs(count: number, type = "test.job") {
  for (let i = 0; i < count; i++) {
    await enqueue(
      db,
      { type, idempotencyKey: `job:${i}`, payload: { n: i }, runAfter: NOW - MIN },
      NOW,
    );
  }
}

/** The test env, with a D1 binding whose prepare() throws for the queries `fails` picks. */
function failingEnv(fails: (query: string) => boolean): typeof env {
  const DB = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          if (fails(query)) throw new Error(`D1 failure for: ${query.slice(0, 40)}`);
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...env, DB };
}

/** A handler that records the payloads it saw. */
function recordingHandler() {
  const seen: unknown[] = [];
  const handler: JobHandler = ({ payload }) => {
    seen.push(payload);
  };
  return { seen, handler };
}

beforeEach(async () => {
  resetJobRegistryForTesting();
  await env.DB.batch(
    ["jobs", "notifications", "activity", "documents", "clients"].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

describe("enqueue", () => {
  it("ignores a second job with the same idempotency key", async () => {
    const first = await enqueue(db, { type: "t", idempotencyKey: "k:1", payload: { a: 1 } });
    const second = await enqueue(db, { type: "t", idempotencyKey: "k:1", payload: { a: 2 } });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    const rows = await jobRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ a: 1 });
  });

  it("enqueues atomically with another write through enqueueStatement", async () => {
    await db.batch([
      db.insert(schema.notifications).values({ type: "t", title: "Hello" }),
      enqueueStatement(db, { type: "t", idempotencyKey: "k:batch" }),
    ]);
    expect(await jobRows()).toHaveLength(1);
  });
});

describe("runTick", () => {
  it("enqueues the jobs a hook returns and runs both through the handler", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("stub.work", handler);
    registerEnqueueHook("stub", ({ today }) => [
      { type: "stub.work", idempotencyKey: `stub:a:${today}`, payload: { name: "a" } },
      { type: "stub.work", idempotencyKey: `stub:b:${today}`, payload: { name: "b" } },
    ]);

    const summary = await runTick(env, NOW);
    expect(summary).toMatchObject({ today: "2026-10-23", enqueued: 2, claimed: 2, done: 2 });
    expect(seen).toEqual([{ name: "a" }, { name: "b" }]);
    const rows = await jobRows();
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    expect(rows.every((r) => r.finishedAt === NOW && r.leaseOwner === null)).toBe(true);

    // A repeated tick finds the same keys and creates no duplicates.
    const again = await runTick(env, NOW + 15 * MIN);
    expect(again).toMatchObject({ enqueued: 0, claimed: 0 });
    expect(seen).toHaveLength(2);
  });

  it("keeps a failing hook from blocking the other hooks and the outbox", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("stub.work", handler);
    registerEnqueueHook("broken", () => {
      throw new Error("hook bug");
    });
    registerEnqueueHook("ok", () => [{ type: "stub.work", idempotencyKey: "ok:1" }]);
    const summary = await runTick(env, NOW);
    expect(summary).toMatchObject({ enqueued: 1, done: 1 });
    expect(seen).toHaveLength(1);
  });

  it("drains jobs when the enqueue and derived-status phases throw", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("test.job", handler);
    await seedJobs(2);
    registerEnqueueHook("ok", () => [{ type: "test.job", idempotencyKey: "from-hook" }]);
    const broken = failingEnv(
      (query) => query.includes("is_overdue = (CASE") || query.startsWith('insert into "jobs"'),
    );
    const summary = await runTick(broken, NOW);
    expect(summary).toMatchObject({ enqueued: 0, claimed: 2, done: 2, errors: 0 });
    expect(seen).toHaveLength(2);
  });

  it("keeps running the other jobs when one job's result cannot be recorded", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("test.job", handler);
    registerJobHandler("test.broken", () => {
      throw new Error("handler bug");
    });
    await enqueue(db, { type: "test.broken", idempotencyKey: "a:broken", runAfter: NOW - 2 * MIN });
    await seedJobs(2);
    // The retry write after the handler error fails, so runJob itself throws.
    const broken = failingEnv(
      (query) =>
        query.startsWith('update "jobs"') &&
        query.includes('"last_error"') &&
        !query.includes('"finished_at"') &&
        !query.includes('"attempts"'),
    );
    const summary = await runTick(broken, NOW);
    expect(summary).toMatchObject({ claimed: 3, done: 2, errors: 1 });
    expect(seen).toHaveLength(2);
    // The lease is the backstop: the broken job stays running until it expires.
    expect((await jobByKey("a:broken")).status).toBe("running");
  });

  it("runs a heavy job only in a :15, :30 or :45 tick, alone", async () => {
    const { seen, handler } = recordingHandler();
    const heavySeen: unknown[] = [];
    registerJobHandler("test.job", handler);
    registerJobHandler(
      "test.heavy",
      ({ payload }) => {
        heavySeen.push(payload);
      },
      { heavy: true },
    );
    let hookCalls = 0;
    registerEnqueueHook("count", () => {
      hookCalls += 1;
      return [];
    });
    for (const n of [1, 2]) {
      await enqueue(
        db,
        { type: "test.heavy", idempotencyKey: `heavy:${n}`, payload: { n }, runAfter: NOW - MIN },
        NOW,
      );
    }
    await seedJobs(1);

    // NOW is a :00 tick: the enqueue phase and the light job, no heavy job.
    expect(await runTick(env, NOW)).toMatchObject({ mode: "normal", claimed: 1, done: 1 });
    expect(heavySeen).toEqual([]);
    expect(await jobByKey("heavy:1")).toMatchObject({ status: "pending", attempts: 0 });
    expect(hookCalls).toBe(1);

    // :15 and :30 run one heavy job each and skip the enqueue phase.
    expect(await runTick(env, NOW + 15 * MIN)).toMatchObject({ mode: "heavy", done: 1 });
    expect(await runTick(env, NOW + 30 * MIN)).toMatchObject({ mode: "heavy", done: 1 });
    expect(heavySeen).toEqual([{ n: 1 }, { n: 2 }]);
    expect(hookCalls).toBe(1);

    // No heavy job left: :45 is a normal tick again.
    expect(await runTick(env, NOW + 45 * MIN)).toMatchObject({ mode: "normal", claimed: 0 });
    expect(hookCalls).toBe(2);
    expect(seen).toHaveLength(1);
  });

  it("stays within the D1 query budget for a tick with 5 jobs", async () => {
    registerJobHandler<{ n: number }>("budget.job", async ({ db: jobDb, payload, now }) => ({
      statements: [
        jobDb.insert(schema.notifications).values({
          type: "t",
          title: `job ${payload.n}`,
          createdAt: now,
        }),
      ],
    }));
    registerEnqueueHook("budget", () =>
      Array.from({ length: 5 }, (_, n) => ({
        type: "budget.job",
        idempotencyKey: `budget:${n}`,
        payload: { n },
      })),
    );

    const { env: counted, counter } = countingEnv();
    const summary = await runTick(counted, NOW);
    expect(summary).toMatchObject({ enqueued: 5, done: 5 });
    const perJob = 3; // the claim, then the handler's insert and the done marker in one batch
    console.log(
      `tick with 5 jobs: ${counter.statements} statements, ${counter.roundTrips} queries`,
    );
    expect(counter.statements).toBeLessThanOrEqual(10 + 5 * perJob);
    expect(summary.queries).toBe(counter.roundTrips);
    expect(counter.roundTrips).toBeLessThanOrEqual(50);
    const notes = await db.select().from(schema.notifications);
    expect(notes).toHaveLength(5);
  });

  it("leaves jobs beyond the batch of 5 for the next tick", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("test.job", handler);
    await seedJobs(7);

    expect(await runTick(env, NOW)).toMatchObject({ claimed: 5, done: 5 });
    expect((await jobRows()).filter((r) => r.status === "pending")).toHaveLength(2);
    expect(await runTick(env, NOW + 15 * MIN)).toMatchObject({ claimed: 2, done: 2 });
    expect(seen).toHaveLength(7);
  });

  it("does not run jobs whose run_after is in the future", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("t", handler);
    await enqueue(db, { type: "t", idempotencyKey: "later", runAfter: NOW + MIN });
    expect(await runTick(env, NOW)).toMatchObject({ claimed: 0 });
    expect(await runTick(env, NOW + MIN)).toMatchObject({ claimed: 1, done: 1 });
    expect(seen).toHaveLength(1);
  });

  it("retries a throwing job with backoff, then fails it and notifies the owner", async () => {
    let calls = 0;
    registerJobHandler("flaky", () => {
      calls += 1;
      throw new Error(`boom ${calls}`);
    });
    await enqueue(
      db,
      { type: "flaky", idempotencyKey: "flaky:1", payload: { documentId: null }, runAfter: NOW },
      NOW,
    );

    expect(await runTick(env, NOW)).toMatchObject({ retried: 1 });
    let job = await jobByKey("flaky:1");
    expect(job).toMatchObject({ status: "pending", attempts: 1, lastError: "boom 1" });
    expect(job.runAfter).toBe(NOW + retryDelayMs(1));

    // Not due yet.
    expect(await runTick(env, NOW + MIN)).toMatchObject({ claimed: 0 });

    const second = job.runAfter;
    expect(await runTick(env, second)).toMatchObject({ retried: 1 });
    job = await jobByKey("flaky:1");
    expect(job).toMatchObject({ status: "pending", attempts: 2 });
    expect(job.runAfter).toBe(second + retryDelayMs(2));
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));

    expect(await runTick(env, job.runAfter)).toMatchObject({ failed: 1 });
    job = await jobByKey("flaky:1");
    expect(job).toMatchObject({ status: "failed", attempts: 3, lastError: "boom 3" });
    expect(calls).toBe(3);

    const notes = await db.select().from(schema.notifications);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "job_failed", readAt: null });
    expect(notes[0]?.body).toContain("flaky failed after 3 attempts: boom 3");

    // A failed job is never claimed again.
    expect(await runTick(env, job.runAfter + 24 * 60 * MIN)).toMatchObject({ claimed: 0 });
  });

  it("fails a job with no registered handler after its attempts", async () => {
    await enqueue(
      db,
      { type: "unknown", idempotencyKey: "u:1", runAfter: NOW, maxAttempts: 1 },
      NOW,
    );
    expect(await runTick(env, NOW)).toMatchObject({ failed: 1 });
    expect((await jobByKey("u:1")).lastError).toContain(
      'No handler is registered for job type "unknown"',
    );
  });

  it("commits the handler's statements and the done marker atomically", async () => {
    registerJobHandler("atomic", ({ db: jobDb }) => ({
      statements: [
        jobDb.insert(schema.notifications).values({ type: "t", title: "first write" }),
        // Violates NOT NULL on title, so the whole batch rolls back.
        jobDb.insert(schema.notifications).values({ type: "t", title: null as unknown as string }),
      ],
    }));
    await enqueue(db, { type: "atomic", idempotencyKey: "atomic:1", runAfter: NOW }, NOW);
    expect(await runTick(env, NOW)).toMatchObject({ retried: 1 });
    expect(await db.select().from(schema.notifications)).toHaveLength(0);
    expect(await jobByKey("atomic:1")).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("defers a job without counting the attempt", async () => {
    registerJobHandler("deferrable", ({ now }) => ({
      defer: { runAfter: now + 60 * MIN, reason: "daily email cap reached" },
    }));
    await enqueue(db, { type: "deferrable", idempotencyKey: "d:1", runAfter: NOW }, NOW);
    expect(await runTick(env, NOW)).toMatchObject({ deferred: 1 });
    expect(await jobByKey("d:1")).toMatchObject({
      status: "pending",
      attempts: 0,
      runAfter: NOW + 60 * MIN,
      lastError: "daily email cap reached",
    });
  });

  it("purges expired mailswitch rows on the :00 tick only", async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mailswitch_idempotency"),
      env.DB.prepare("DELETE FROM mailswitch_webhook_dedupe"),
    ]);
    const idem = (key: string, state: string, expiresAt: number | null) =>
      env.DB.prepare(
        `INSERT INTO mailswitch_idempotency (key, payload_hash, state, claim_id, claimed_at, updated_at, expires_at)
         VALUES (?, 'h', ?, 'c', 0, 0, ?)`,
      ).bind(key, state, expiresAt);
    const dedupe = (key: string, expiresAt: number) =>
      env.DB.prepare(
        "INSERT INTO mailswitch_webhook_dedupe (key, committed, expires_at, lease_id) VALUES (?, 1, ?, 'l')",
      ).bind(key, expiresAt);
    const seed = () =>
      env.DB.batch([
        idem("old-sent", "sent", NOW - MIN),
        idem("old-unknown", "unknown", NOW - MIN),
        idem("new-sent", "sent", NOW + MIN),
        dedupe("old", NOW - MIN),
        dedupe("new", NOW + MIN),
      ]);
    const keys = async (table: string) =>
      (await env.DB.prepare(`SELECT key FROM ${table} ORDER BY key`).all<{ key: string }>()).results
        .map((r) => r.key)
        .join(",");
    await seed();

    // :15 does not purge.
    await runTick(env, NOW + 15 * MIN);
    expect(await keys("mailswitch_idempotency")).toBe("new-sent,old-sent,old-unknown");
    expect(await keys("mailswitch_webhook_dedupe")).toBe("new,old");

    // :00 purges finished expired keys. An unknown key stays for the Owner to resolve.
    await runTick(env, NOW);
    expect(await keys("mailswitch_idempotency")).toBe("new-sent,old-unknown");
    expect(await keys("mailswitch_webhook_dedupe")).toBe("new");
  });
});

describe("claimJobs", () => {
  it("gives two overlapping claims disjoint jobs", async () => {
    await seedJobs(8);
    const [a, b] = await Promise.all([
      claimJobs(db, { owner: "tick-a", now: NOW }),
      claimJobs(db, { owner: "tick-b", now: NOW }),
    ]);
    const idsA = new Set(a.map((j) => j.id));
    const idsB = new Set(b.map((j) => j.id));
    expect(a.length + b.length).toBe(8);
    expect([...idsA].filter((id) => idsB.has(id))).toEqual([]);
    expect(a.every((j) => j.leaseOwner === "tick-a" && j.leaseUntil === NOW + JOB_LEASE_MS)).toBe(
      true,
    );
  });

  it("runs every job once when two ticks overlap", async () => {
    const runs = new Map<number, number>();
    registerJobHandler<{ n: number }>("test.job", async ({ payload }) => {
      runs.set(payload.n, (runs.get(payload.n) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await seedJobs(6);
    const results = await Promise.all([runTick(env, NOW), runTick(env, NOW)]);
    expect(results.reduce((sum, r) => sum + r.done, 0)).toBe(6);
    expect([...runs.values()]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("reclaims a job whose lease expired", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("test.job", handler);
    await seedJobs(1);
    const [stuck] = await claimJobs(db, { owner: "dead-tick", now: NOW });
    expect(stuck).toBeDefined();
    expect(await runTick(env, NOW + MIN)).toMatchObject({ claimed: 0 });
    expect(await runTick(env, NOW + JOB_LEASE_MS + MIN)).toMatchObject({ claimed: 1, done: 1 });
    expect(seen).toHaveLength(1);
    expect(await jobByKey("job:0")).toMatchObject({ status: "done", attempts: 2 });
  });

  it("fails a job whose lease expired on every attempt", async () => {
    registerJobHandler("test.job", () => undefined);
    await enqueue(
      db,
      { type: "test.job", idempotencyKey: "j", runAfter: NOW, maxAttempts: 1 },
      NOW,
    );
    await claimJobs(db, { owner: "dead-tick", now: NOW });
    expect(await runTick(env, NOW + JOB_LEASE_MS + MIN)).toMatchObject({ failed: 1 });
    expect(await db.select().from(schema.notifications)).toHaveLength(1);
  });
});

describe("runJobSoon", () => {
  it("runs one job after the response, and the cron tick does not repeat it", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("soon", handler);
    const { id } = await enqueue(db, { type: "soon", idempotencyKey: "soon:1", payload: { x: 1 } });
    await enqueue(db, { type: "soon", idempotencyKey: "soon:2", payload: { x: 2 } });
    const ctx = createExecutionContext();
    runJobSoon(ctx, env, id);
    await waitOnExecutionContext(ctx);
    expect(seen).toEqual([{ x: 1 }]);
    expect(await jobByKey("soon:1")).toMatchObject({ status: "done" });
    expect(await jobByKey("soon:2")).toMatchObject({ status: "pending" });

    await runTick(env, Date.now() + MIN);
    expect(seen).toEqual([{ x: 1 }, { x: 2 }]);
  });
});

describe("derived statuses", () => {
  async function seedDocs() {
    const [client] = await db.insert(schema.clients).values({ name: "Northwind" }).returning();
    if (!client) throw new Error("client insert failed");
    const base = { clientId: client.id, currency: "USD", total: 10000 };
    const docs = {
      pastDue: { ...base, kind: "invoice", status: "sent", dueDate: "2026-10-22" },
      dueToday: { ...base, kind: "invoice", status: "sent", dueDate: "2026-10-23" },
      partial: {
        ...base,
        kind: "invoice",
        status: "partially_paid",
        dueDate: "2026-10-01",
        amountPaid: 4000,
      },
      paid: { ...base, kind: "invoice", status: "paid", dueDate: "2026-10-01", amountPaid: 10000 },
      draft: { ...base, kind: "invoice", status: "draft", dueDate: "2026-10-01" },
      noLongerOverdue: {
        ...base,
        kind: "invoice",
        status: "sent",
        dueDate: "2026-11-30",
        isOverdue: true,
      },
      expiredQuote: { ...base, kind: "quote", status: "sent", expiryDate: "2026-10-22" },
      liveQuote: { ...base, kind: "quote", status: "sent", expiryDate: "2026-10-23" },
      acceptedQuote: { ...base, kind: "quote", status: "accepted", expiryDate: "2026-10-01" },
    } satisfies Record<string, schema.NewDocument>;
    const ids: Record<string, string> = {};
    for (const [name, values] of Object.entries(docs)) {
      const [doc] = await db.insert(schema.documents).values(values).returning();
      if (!doc) throw new Error(`${name} insert failed`);
      ids[name] = doc.id;
    }
    return ids;
  }

  it("marks overdue invoices and expired quotes using the Dhaka date", async () => {
    const ids = await seedDocs();
    // 19:00 UTC on Oct 22 is already Oct 23 in Dhaka, so a Oct 22 due date has passed.
    const summary = await runTick(env, Date.parse("2026-10-22T19:00:00Z"));
    expect(summary.today).toBe("2026-10-23");

    const rows = await db.select().from(schema.documents);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const get = (name: string) => byId.get(ids[name] ?? "");
    expect(get("pastDue")?.isOverdue).toBe(true);
    expect(get("partial")?.isOverdue).toBe(true);
    expect(get("dueToday")?.isOverdue).toBe(false);
    expect(get("paid")?.isOverdue).toBe(false);
    expect(get("draft")?.isOverdue).toBe(false);
    expect(get("noLongerOverdue")?.isOverdue).toBe(false);
    expect(get("expiredQuote")?.status).toBe("expired");
    expect(get("liveQuote")?.status).toBe("sent");
    expect(get("acceptedQuote")?.status).toBe("accepted");

    const activity = await db.select().from(schema.activity);
    const events = activity.map((a) => `${a.type}:${a.documentId}`).sort();
    expect(events).toEqual(
      [
        `invoice_overdue:${ids.pastDue}`,
        `invoice_overdue:${ids.partial}`,
        `quote_expired:${ids.expiredQuote}`,
      ].sort(),
    );
    expect(
      activity.every((a) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.id),
      ),
    ).toBe(true);

    // A second tick changes nothing and writes no more activity.
    await runTick(env, Date.parse("2026-10-22T19:15:00Z"));
    expect(await db.select().from(schema.activity)).toHaveLength(3);
  });

  it("keeps the Oct 22 invoice current at 17:00 UTC (23:00 in Dhaka)", async () => {
    const ids = await seedDocs();
    const summary = await runTick(env, Date.parse("2026-10-22T17:00:00Z"));
    expect(summary.today).toBe("2026-10-22");
    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, ids.pastDue ?? ""));
    expect(doc?.isOverdue).toBe(false);
  });
});

describe("scheduled handler", () => {
  it("runs a stub job end to end against local D1 with a fixed clock", async () => {
    const { seen, handler } = recordingHandler();
    registerJobHandler("stub.cron", handler);
    registerEnqueueHook("cron", ({ today }) => [
      { type: "stub.cron", idempotencyKey: `cron:${today}`, payload: { today } },
    ]);
    const scheduledTime = new Date("2026-10-23T18:30:00Z"); // Oct 24 in Dhaka

    const trigger = async () => {
      const controller = createScheduledController({ scheduledTime, cron: "*/15 * * * *" });
      const ctx = createExecutionContext();
      await worker.scheduled(controller, env, ctx);
      await waitOnExecutionContext(ctx);
    };
    await trigger();
    expect(seen).toEqual([{ today: "2026-10-24" }]);
    expect(await jobByKey("cron:2026-10-24")).toMatchObject({
      status: "done",
      finishedAt: scheduledTime.getTime(),
    });

    await trigger();
    expect(seen).toHaveLength(1);
  });
});
