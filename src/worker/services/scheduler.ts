// The cron tick: enqueue due work, update derived statuses, then drain a small batch of
// jobs. Workers Free gives a cron run 10 ms CPU and 50 subrequests, so every step is
// a few D1 statements and the job batch is small.
import { todayIn, WORKSPACE_TIMEZONE } from "../../shared/time";
import { createDb, type Db, schema } from "../db/client";
import type { Workspace } from "../db/schema";
import type { Bindings } from "../env";
import {
  claimJobs,
  type EnqueueInput,
  enqueueMany,
  getEnqueueHooks,
  JOB_BATCH_SIZE,
  type JobRunStatus,
  runJob,
} from "./jobs";

export interface TickSummary {
  today: string;
  enqueued: number;
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  deferred: number;
}

export interface TickOptions {
  batchSize?: number;
  /** Lease owner ID. Defaults to a random ID per tick. */
  owner?: string;
}

/** One scheduler run. `now` is the cron's scheduled time, so tests can fix the clock. */
export async function runTick(
  env: Bindings,
  now: Date | number,
  options: TickOptions = {},
): Promise<TickSummary> {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const db = createDb(env.DB);
  const workspace = await loadWorkspace(db);
  const today = todayIn(workspace.timezone || WORKSPACE_TIMEZONE, nowMs);

  // 1. Enqueue hooks. A failing hook is logged and does not block the outbox.
  const inputs: EnqueueInput[] = [];
  for (const [name, hook] of getEnqueueHooks()) {
    try {
      const found = await hook({ env, db, now: nowMs, today, workspace });
      if (found) inputs.push(...found);
    } catch (err) {
      console.error(`Enqueue hook "${name}" failed`, err);
    }
  }
  const enqueued = await enqueueMany(db, inputs, nowMs);

  // 2. Derived statuses.
  await updateDerivedStatuses(db, today, nowMs);

  // 3 and 4. Claim and run jobs, one at a time to keep subrequests predictable.
  const owner = options.owner ?? `tick:${crypto.randomUUID()}`;
  const claimed = await claimJobs(db, {
    owner,
    now: nowMs,
    limit: options.batchSize ?? JOB_BATCH_SIZE,
  });
  const counts: Record<JobRunStatus, number> = { done: 0, retry: 0, failed: 0, deferred: 0 };
  for (const job of claimed) {
    counts[await runJob(env, db, job, nowMs)] += 1;
  }

  return {
    today,
    enqueued,
    claimed: claimed.length,
    done: counts.done,
    retried: counts.retry,
    failed: counts.failed,
    deferred: counts.deferred,
  };
}

async function loadWorkspace(db: Db): Promise<Workspace> {
  const [workspace] = await db.select().from(schema.workspace).limit(1);
  if (!workspace) throw new Error("The workspace row is missing. Apply the seed migration.");
  return workspace;
}

/** A random UUID v4 string built in SQL, for INSERT ... SELECT. */
const SQL_UUID = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** ?1 is today (workspace timezone). */
const OVERDUE = `(status IN ('sent', 'partially_paid') AND due_date IS NOT NULL AND due_date < ?1 AND total - amount_paid > 0)`;
const EXPIRED = `(kind = 'quote' AND status = 'sent' AND expiry_date IS NOT NULL AND expiry_date < ?1)`;

/**
 * Persists derived statuses for list filters, in one D1 batch (4 statements):
 * - invoices are overdue when sent or partially paid, past due in the workspace timezone,
 *   and with a balance above zero. The flag also clears when that stops being true.
 * - sent quotes past their expiry date become expired.
 * Each change writes one activity row.
 */
export async function updateDerivedStatuses(db: Db, today: string, now: number): Promise<void> {
  const d1 = db.$client;
  const statements = [
    `INSERT INTO activity (id, document_id, client_id, type, data, created_at)
     SELECT ${SQL_UUID}, id, client_id, 'invoice_overdue', json_object('dueDate', due_date), ?2
     FROM documents WHERE kind = 'invoice' AND is_overdue = 0 AND ${OVERDUE}`,
    `UPDATE documents SET is_overdue = (CASE WHEN ${OVERDUE} THEN 1 ELSE 0 END), updated_at = ?2
     WHERE kind = 'invoice' AND is_overdue <> (CASE WHEN ${OVERDUE} THEN 1 ELSE 0 END)`,
    `INSERT INTO activity (id, document_id, client_id, type, data, created_at)
     SELECT ${SQL_UUID}, id, client_id, 'quote_expired', json_object('expiryDate', expiry_date), ?2
     FROM documents WHERE ${EXPIRED}`,
    `UPDATE documents SET status = 'expired', updated_at = ?2 WHERE ${EXPIRED}`,
  ];
  await d1.batch(statements.map((query) => d1.prepare(query).bind(today, now)));
}
