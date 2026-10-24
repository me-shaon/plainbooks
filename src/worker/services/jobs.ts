// Generic job outbox. Feature units register handlers and enqueue hooks here:
//   registerJobHandler("email.send", handler)     (U13)
//   registerEnqueueHook("recurring", hook)        (U15)
// Register at module scope in the feature's service file, and import that file from
// src/worker/index.ts so the registration runs in every isolate.
import { and, eq, inArray, lt, lte, notInArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { createRequestDb, type Db, schema } from "../db/client";
import type { Workspace } from "../db/schema";
import type { Bindings } from "../env";
import { AppError } from "../errors";

const { jobs, notifications } = schema;

/** A Drizzle query that has not run yet. Handlers return these to commit atomically. */
export type BatchStatement = BatchItem<"sqlite">;

/** The most jobs one tick runs. The query budget below usually stops it sooner. */
export const JOB_BATCH_SIZE = 5;
/** Workers Free allows 50 D1 queries per invocation. Every statement in a batch counts. */
export const TICK_QUERY_BUDGET = 50;
/** The most queries a light job (for example send_email) may use, its done marker included. */
export const LIGHT_JOB_QUERIES = 10;
/** Queries kept free for the retry or failure write after a job. */
export const JOB_FAILURE_RESERVE = 2;
/** A claimed job is leased for this long. After that, another tick can claim it again. */
export const JOB_LEASE_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_ATTEMPTS = 3;
/** D1 allows 100 bound parameters per statement. A job row binds 8 values. */
const ROWS_PER_INSERT = 12;

export interface EnqueueInput {
  type: string;
  payload?: unknown;
  /** Unique per unit of work, for example `recurring:<scheduleId>:2026-10`. */
  idempotencyKey: string;
  /** Earliest run time in ms. Defaults to now. */
  runAfter?: number;
  maxAttempts?: number;
}

export type ClaimedJob = typeof jobs.$inferSelect;

export interface JobContext<P = unknown> {
  env: Bindings;
  db: Db;
  /** The tick time in ms. Use it instead of Date.now() so tests can fix the clock. */
  now: number;
  payload: P;
  job: ClaimedJob;
}

/**
 * What a handler returns:
 * - nothing: the job is marked done.
 * - `{ statements }`: the statements and the done marker run in one D1 batch.
 * - `{ defer }`: the job goes back to pending until `runAfter`. The attempt is not counted.
 * Throw to fail the attempt. The job retries with backoff, then fails and notifies the owner.
 */
export type JobOutcome =
  | undefined
  | { statements: BatchStatement[] }
  | { defer: { runAfter: number; reason?: string } };

export type JobHandler<P = unknown> = (ctx: JobContext<P>) => Promise<JobOutcome> | JobOutcome;

export interface EnqueueHookContext {
  env: Bindings;
  db: Db;
  now: number;
  /** Today in the workspace timezone. */
  today: string;
  workspace: Workspace;
}

/** Runs at the start of each tick. Returns jobs to enqueue (duplicates are ignored). */
export type EnqueueHook = (
  ctx: EnqueueHookContext,
) => Promise<EnqueueInput[] | undefined> | EnqueueInput[] | undefined;

const handlers = new Map<string, JobHandler>();
const hooks = new Map<string, EnqueueHook>();
const heavyTypes = new Set<string>();

export interface JobHandlerOptions {
  /**
   * The job can use up to about 45 D1 queries (a document send: finalize, PDF, email,
   * mark sent). The scheduler runs a heavy job only in a tick of its own.
   */
  heavy?: boolean;
}

export function registerJobHandler<P>(
  type: string,
  handler: JobHandler<P>,
  options: JobHandlerOptions = {},
): void {
  handlers.set(type, handler as JobHandler);
  if (options.heavy) heavyTypes.add(type);
  else heavyTypes.delete(type);
}

/** The job types registered as heavy. */
export function getHeavyJobTypes(): string[] {
  return [...heavyTypes];
}

export function registerEnqueueHook(name: string, hook: EnqueueHook): void {
  hooks.set(name, hook);
}

export function getEnqueueHooks(): [string, EnqueueHook][] {
  return [...hooks];
}

/** Tests only: removes every handler and hook. */
export function resetJobRegistryForTesting(): void {
  handlers.clear();
  hooks.clear();
  heavyTypes.clear();
}

function toRow(input: EnqueueInput, now: number) {
  return {
    id: crypto.randomUUID(),
    type: input.type,
    payload: input.payload ?? {},
    idempotencyKey: input.idempotencyKey,
    runAfter: input.runAfter ?? now,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Returns an INSERT ... ON CONFLICT(idempotency_key) DO NOTHING statement. Put it in the
 * same `db.batch()` as the write that causes the job, so both commit or neither does.
 */
export function enqueueStatement(db: Db, input: EnqueueInput, now = Date.now()) {
  return db
    .insert(jobs)
    .values(toRow(input, now))
    .onConflictDoNothing({ target: jobs.idempotencyKey });
}

/**
 * A raw D1 form of `enqueueStatement` that inserts only when `guard` (SQL) is true at that
 * point of the batch. Use it after a guarded UPDATE, so a rejected change queues no job.
 */
export function guardedEnqueueStatement(
  d1: D1Database,
  input: EnqueueInput,
  now: number,
  guard: string,
  guardParams: unknown[],
): D1PreparedStatement {
  const row = toRow(input, now);
  return d1
    .prepare(
      `INSERT INTO jobs (id, type, payload, idempotency_key, run_after, max_attempts, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(
      row.id,
      row.type,
      JSON.stringify(row.payload),
      row.idempotencyKey,
      row.runAfter,
      row.maxAttempts,
      row.createdAt,
      row.updatedAt,
      ...guardParams,
    );
}

/** The ID of the job with this idempotency key, or null. */
export async function jobIdByKey(db: Db, idempotencyKey: string): Promise<string | null> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, idempotencyKey));
  return row?.id ?? null;
}

/** Enqueues one job. `created` is false when a job with the same key already exists. */
export async function enqueue(
  db: Db,
  input: EnqueueInput,
  now = Date.now(),
): Promise<{ id: string; created: boolean }> {
  const [inserted] = await enqueueStatement(db, input, now).returning({ id: jobs.id });
  if (inserted) return { id: inserted.id, created: true };
  const existing = await jobIdByKey(db, input.idempotencyKey);
  if (!existing) throw new Error(`Could not enqueue job ${input.idempotencyKey}`);
  return { id: existing, created: false };
}

/** Enqueues many jobs with one D1 batch. Returns how many were new. */
export async function enqueueMany(db: Db, inputs: EnqueueInput[], now = Date.now()) {
  if (inputs.length === 0) return 0;
  const statements: BatchStatement[] = [];
  for (let i = 0; i < inputs.length; i += ROWS_PER_INSERT) {
    const rows = inputs.slice(i, i + ROWS_PER_INSERT).map((input) => toRow(input, now));
    statements.push(
      db
        .insert(jobs)
        .values(rows)
        .onConflictDoNothing({ target: jobs.idempotencyKey })
        .returning({ id: jobs.id }),
    );
  }
  const results = (await db.batch(statements as [BatchStatement, ...BatchStatement[]])) as {
    id: string;
  }[][];
  return results.reduce((sum, rows) => sum + rows.length, 0);
}

export interface ClaimOptions {
  /** Unique per tick or per runJobSoon call. */
  owner: string;
  now: number;
  limit?: number;
  /** Claim only these jobs (runJobSoon). */
  ids?: string[];
  /** Claim only jobs of these types. */
  types?: string[];
  /** Do not claim jobs of these types. */
  excludeTypes?: string[];
}

/**
 * Claims due jobs with one conditional UPDATE. A job is due when it is pending and its
 * run_after has passed, or when it is running and its lease has expired. D1 runs each
 * statement atomically, so overlapping ticks always get disjoint jobs.
 */
export async function claimJobs(db: Db, options: ClaimOptions): Promise<ClaimedJob[]> {
  const { owner, now, limit = JOB_BATCH_SIZE, ids, types, excludeTypes } = options;
  if (types?.length === 0) return [];
  const claimable = and(
    or(
      and(eq(jobs.status, "pending"), lte(jobs.runAfter, now)),
      and(eq(jobs.status, "running"), lt(jobs.leaseUntil, now)),
    ),
    ids ? inArray(jobs.id, ids) : undefined,
    types ? inArray(jobs.type, types) : undefined,
    excludeTypes?.length ? notInArray(jobs.type, excludeTypes) : undefined,
  );
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(claimable)
    .orderBy(jobs.runAfter, jobs.createdAt)
    .limit(limit);
  return db
    .update(jobs)
    .set({
      status: "running",
      leaseOwner: owner,
      leaseUntil: now + JOB_LEASE_MS,
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(inArray(jobs.id, due), claimable))
    .returning();
}

/** Delay before the next attempt: 5 min, 15 min, 45 min, ... capped at 6 h. */
export function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60 * 1000 * 3 ** Math.max(0, attempt - 1), 6 * 60 * 60 * 1000);
}

export type JobRunStatus = "done" | "retry" | "failed" | "deferred";

const leaseHeld = (job: ClaimedJob) =>
  and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, job.leaseOwner ?? ""));

/** Runs one claimed job and records the result. Never throws for handler errors. */
export async function runJob(
  env: Bindings,
  db: Db,
  job: ClaimedJob,
  now: number,
): Promise<JobRunStatus> {
  if (job.attempts > job.maxAttempts) {
    // The lease expired on every attempt, for example because the isolate was killed.
    return fail(db, job, now, "The job did not finish before its lease expired");
  }
  const handler = handlers.get(job.type);
  let outcome: JobOutcome;
  try {
    if (!handler) throw new Error(`No handler is registered for job type "${job.type}"`);
    outcome = await handler({ env, db, now, payload: job.payload, job });
  } catch (err) {
    return retryOrFail(db, job, now, err);
  }

  if (outcome && "defer" in outcome) {
    await db
      .update(jobs)
      .set({
        status: "pending",
        runAfter: outcome.defer.runAfter,
        attempts: sql`${jobs.attempts} - 1`,
        lastError: outcome.defer.reason ?? null,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(leaseHeld(job));
    return "deferred";
  }

  const done = db
    .update(jobs)
    .set({ status: "done", finishedAt: now, leaseOwner: null, leaseUntil: null, updatedAt: now })
    .where(leaseHeld(job));
  const statements = outcome?.statements ?? [];
  try {
    // The handler's writes first, then the done marker, in order.
    const batch: BatchStatement[] = [...statements, done];
    await db.batch(batch as [BatchStatement, ...BatchStatement[]]);
  } catch (err) {
    // The batch is atomic: none of the job's writes were committed.
    return retryOrFail(db, job, now, err);
  }
  return "done";
}

async function retryOrFail(
  db: Db,
  job: ClaimedJob,
  now: number,
  err: unknown,
): Promise<JobRunStatus> {
  const message = errorMessage(err);
  if (job.attempts >= job.maxAttempts) return fail(db, job, now, message);
  await db
    .update(jobs)
    .set({
      status: "pending",
      runAfter: now + retryDelayMs(job.attempts),
      lastError: message,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(leaseHeld(job));
  return "retry";
}

/** Marks the job failed and adds an owner notification, in one batch. */
async function fail(db: Db, job: ClaimedJob, now: number, message: string): Promise<JobRunStatus> {
  await db.batch([
    db
      .update(jobs)
      .set({
        status: "failed",
        lastError: message,
        finishedAt: now,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(leaseHeld(job)),
    db.insert(notifications).values({
      type: "job_failed",
      title: "A background task failed",
      body: `${job.type} failed after ${Math.min(job.attempts, job.maxAttempts)} attempts: ${message}`,
      documentId: documentIdOf(job.payload),
      createdAt: now,
    }),
  ]);
  return "failed";
}

function documentIdOf(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "documentId" in payload) {
    const value = (payload as { documentId: unknown }).documentId;
    if (typeof value === "string") return value;
  }
  return null;
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, 1000);
}

/** Claims and runs one job by ID, if it is due. Returns null when another run has it. */
export async function runJobById(
  env: Bindings,
  jobId: string,
  now = Date.now(),
): Promise<JobRunStatus | null> {
  const db = createRequestDb(env.DB);
  const [job] = await claimJobs(db, { owner: `soon:${crypto.randomUUID()}`, now, ids: [jobId] });
  return job ? runJob(env, db, job, now) : null;
}

/**
 * Runs a job right after the response, so interactive actions do not wait for the next
 * cron tick. The cron tick stays the backstop if this run fails or the isolate stops.
 */
export function runJobSoon(
  ctx: Pick<ExecutionContext, "waitUntil">,
  env: Bindings,
  jobId: string,
): void {
  ctx.waitUntil(
    runJobById(env, jobId).then(
      () => undefined,
      (err: unknown) => console.error(`runJobSoon(${jobId}) failed`, err),
    ),
  );
}

/**
 * Puts a failed job back in the queue with a fresh attempt count. It runs on the next
 * tick, or sooner when the caller uses runJobSoon. 404 if missing, 409 if not failed.
 */
export async function retryFailedJob(db: Db, jobId: string, now: number): Promise<ClaimedJob> {
  const [job] = await db
    .update(jobs)
    .set({
      status: "pending",
      attempts: 0,
      runAfter: now,
      finishedAt: null,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "failed")))
    .returning();
  if (job) return job;
  const [existing] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId));
  if (!existing) throw new AppError(404, "job_not_found", "This job does not exist");
  throw new AppError(409, "job_not_failed", "Only a failed job can be retried");
}
