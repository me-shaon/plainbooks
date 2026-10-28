// The cron tick: enqueue due work, update derived statuses, then drain a few jobs. Workers
// Free gives a cron run 10 ms CPU and 50 D1 queries, so the tick counts its queries and
// claims a job only when the rest of the budget can pay for it. One batch() call is one
// query, whatever the number of statements in it.
//
// A heavy job (a document send uses about 30 queries) does not fit next to the enqueue
// phase and the light jobs. So the :15, :30 and :45 ticks first claim one due heavy job and run only that
// job. The :00 tick always runs the enqueue phase, so derived statuses and new jobs never
// wait more than an hour behind a queue of heavy jobs. It also purges the expired
// mailswitch idempotency and webhook dedupe rows (2 queries).
import { D1DedupeStore, D1IdempotencyStore } from "mailswitch/stores/d1";
import { todayIn, WORKSPACE_TIMEZONE } from "../../shared/time";
import { createRequestDb, type Db } from "../db/client";
import type { Bindings } from "../env";
import { loadWorkspace } from "./documents";
import {
  type ClaimedJob,
  claimJobs,
  type EnqueueInput,
  enqueueMany,
  getEnqueueHooks,
  getHeavyJobTypes,
  JOB_BATCH_SIZE,
  JOB_FAILURE_RESERVE,
  type JobRunStatus,
  LIGHT_JOB_QUERIES,
  runJob,
  TICK_QUERY_BUDGET,
} from "./jobs";
import { overdueCondition } from "./status-sql";

/** The cron interval. */
export const TICK_INTERVAL_MS = 15 * 60 * 1000;

export interface TickSummary {
  today: string;
  /** "heavy" when the tick ran one heavy job and skipped the enqueue phase. */
  mode: "normal" | "heavy";
  enqueued: number;
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  deferred: number;
  /** Email jobs whose send ended `unknown`. A person decides what happens next. */
  needsReview: number;
  /** Jobs whose result could not be recorded. Their lease expires and they run again. */
  errors: number;
  /** D1 queries this tick sent: batch() calls plus statements run on their own. */
  queries: number;
}

export interface TickOptions {
  batchSize?: number;
  /** Lease owner ID. Defaults to a random ID per tick. */
  owner?: string;
}

/** The D1 statement methods that send one query. */
const RUN_METHODS = new Set<PropertyKey>(["run", "all", "first", "raw"]);

/** The real statement behind each counting proxy. `batch()` gets the real ones. */
const proxied = new WeakMap<D1PreparedStatement, D1PreparedStatement>();

function unwrapStatement(statement: D1PreparedStatement): D1PreparedStatement {
  return proxied.get(statement) ?? statement;
}

/**
 * Wraps a D1 binding and counts its queries toward the per-invocation limit: one per
 * `batch()` call and one per statement that runs on its own. A statement inside a batch
 * does not count again.
 */
export function countQueries(d1: D1Database): { d1: D1Database; count: () => number } {
  let count = 0;
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        if (prop === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values));
        }
        if (RUN_METHODS.has(prop)) {
          return (...args: unknown[]) => {
            count += 1;
            return value.apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
    proxied.set(proxy, statement);
    return proxy;
  };
  const wrapped = new Proxy(d1, {
    get(target, prop) {
      if (prop === "prepare") return (query: string) => wrapStatement(target.prepare(query));
      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) => {
          count += 1;
          return target.batch(statements.map(unwrapStatement));
        };
      }
      if (prop === "exec") {
        return (query: string) => {
          count += 1;
          return target.exec(query);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { d1: wrapped, count: () => count };
}

/** True for the :15, :30 and :45 ticks, which may run one heavy job. */
export function isHeavySlot(now: number): boolean {
  return Math.floor(now / TICK_INTERVAL_MS) % 4 !== 0;
}

/** One scheduler run. `now` is the cron's scheduled time, so tests can fix the clock. */
export async function runTick(
  env: Bindings,
  now: Date | number,
  options: TickOptions = {},
): Promise<TickSummary> {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const queries = countQueries(env.DB);
  const tickEnv: Bindings = { ...env, DB: queries.d1 };
  // One tick is one invocation, so its handle may reuse the workspace row.
  const db = createRequestDb(queries.d1);
  const owner = options.owner ?? `tick:${crypto.randomUUID()}`;
  const counts: Record<JobRunStatus | "error", number> = {
    done: 0,
    retry: 0,
    failed: 0,
    deferred: 0,
    needs_review: 0,
    error: 0,
  };
  const run = async (job: ClaimedJob) => {
    try {
      counts[await runJob(tickEnv, db, job, nowMs)] += 1;
    } catch (err) {
      // Most likely D1 failed while it recorded the result. The lease is the backstop.
      counts.error += 1;
      console.error(`Job ${job.id} (${job.type}) did not finish`, err);
    }
  };
  const summary = (
    mode: TickSummary["mode"],
    today: string,
    enqueued: number,
    claimed: number,
  ) => ({
    today,
    mode,
    enqueued,
    claimed,
    done: counts.done,
    retried: counts.retry,
    failed: counts.failed,
    deferred: counts.deferred,
    needsReview: counts.needs_review,
    errors: counts.error,
    queries: queries.count(),
  });

  const heavy = getHeavyJobTypes();
  if (heavy.length > 0 && isHeavySlot(nowMs)) {
    const [job] = await claimJobs(db, { owner, now: nowMs, limit: 1, types: heavy });
    if (job) {
      await run(job);
      return summary("heavy", todayIn(WORKSPACE_TIMEZONE, nowMs), 0, 1);
    }
  }

  const workspace = await loadWorkspace(db);
  const today = todayIn(workspace.timezone || WORKSPACE_TIMEZONE, nowMs);

  // 1. Enqueue hooks. A failing phase is logged and does not block the outbox.
  const inputs: EnqueueInput[] = [];
  for (const [name, hook] of getEnqueueHooks()) {
    try {
      const found = await hook({ env: tickEnv, db, now: nowMs, today, workspace });
      if (found) inputs.push(...found);
    } catch (err) {
      console.error(`Enqueue hook "${name}" failed`, err);
    }
  }
  let enqueued = 0;
  try {
    enqueued = await enqueueMany(db, inputs, nowMs);
  } catch (err) {
    console.error("Enqueueing the hook jobs failed", err);
  }

  // 2. Derived statuses.
  try {
    await updateDerivedStatuses(db, today, nowMs);
  } catch (err) {
    console.error("Updating derived statuses failed", err);
  }

  // 3. Purge expired mailswitch rows. Once an hour is enough, and a heavy tick has no
  // room for it, so only the :00 tick runs it.
  if (!isHeavySlot(nowMs)) {
    try {
      await purgeMailswitchStores(queries.d1, nowMs);
    } catch (err) {
      console.error("Purging the mailswitch stores failed", err);
    }
  }

  // 4 and 5. Claim and run light jobs one at a time, while the budget can pay for one more.
  const limit = options.batchSize ?? JOB_BATCH_SIZE;
  const perJob = 1 + LIGHT_JOB_QUERIES + JOB_FAILURE_RESERVE;
  let claimed = 0;
  while (claimed < limit && queries.count() + perJob <= TICK_QUERY_BUDGET) {
    const [job] = await claimJobs(db, { owner, now: nowMs, limit: 1, excludeTypes: heavy });
    if (!job) break;
    claimed += 1;
    await run(job);
  }

  return summary("normal", today, enqueued, claimed);
}

/**
 * Deletes the expired rows of the mailswitch stores: finished idempotency keys past their
 * TTL and webhook dedupe keys past their lease or TTL. One statement per store, and each
 * one searches the `expires_at` index.
 */
export async function purgeMailswitchStores(d1: D1Database, now: number): Promise<void> {
  await new D1IdempotencyStore(d1).purgeExpired(now);
  await new D1DedupeStore(d1).purgeExpired(now);
}

/** A random UUID v4 string built in SQL, for INSERT ... SELECT. */
const SQL_UUID = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** ?1 is today (workspace timezone). */
const OVERDUE = overdueCondition("?1");
const EXPIRED = `(kind = 'quote' AND status = 'sent' AND expiry_date IS NOT NULL AND expiry_date < ?1)`;

/**
 * Persists derived statuses for list filters, in one D1 batch (5 statements):
 * - invoices are overdue when sent or partially paid, past due in the workspace timezone,
 *   and with a balance above zero. The flag also clears when that stops being true.
 * - sent quotes past their expiry date become expired.
 * Each change writes one activity row.
 *
 * Every statement reads only candidate rows through an index, because the tick runs 96
 * times a day and D1 bills rows read. Setting the flag searches open invoices by due date
 * (documents_kind_status_due_idx). Clearing it searches only flagged invoices
 * (documents_overdue_idx). Rows whose flag is already right are not written.
 */
export async function updateDerivedStatuses(db: Db, today: string, now: number): Promise<void> {
  const d1 = db.$client;
  const statements = [
    `INSERT INTO activity (id, document_id, client_id, type, data, created_at)
     SELECT ${SQL_UUID}, id, client_id, 'invoice_overdue', json_object('dueDate', due_date), ?2
     FROM documents WHERE is_overdue = 0 AND ${OVERDUE}`,
    `UPDATE documents SET is_overdue = 1, updated_at = ?2 WHERE is_overdue = 0 AND ${OVERDUE}`,
    `UPDATE documents SET is_overdue = 0, updated_at = ?2
     WHERE kind = 'invoice' AND is_overdue = 1 AND NOT ${OVERDUE}`,
    `INSERT INTO activity (id, document_id, client_id, type, data, created_at)
     SELECT ${SQL_UUID}, id, client_id, 'quote_expired', json_object('expiryDate', expiry_date), ?2
     FROM documents WHERE ${EXPIRED}`,
    `UPDATE documents SET status = 'expired', updated_at = ?2 WHERE ${EXPIRED}`,
  ];
  await d1.batch(statements.map((query) => d1.prepare(query).bind(today, now)));
}
