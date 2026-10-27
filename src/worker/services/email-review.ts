// Needs review (U4): email jobs whose send ended `unknown`. The email may have gone out, so
// the scheduler never runs them again. An Owner resolves each one:
// - "Mark as sent" records the send and moves the document to sent. No email goes out.
// - "Send again" releases the mailswitch key and queues the job, which sends once.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { D1IdempotencyStore } from "mailswitch/stores/d1";
import type { ReviewJobView } from "../../shared/schemas/dashboard";
import { type Db, schema } from "../db/client";
import { MAILER_NAMESPACE } from "../email/mailer";
import type { AuthUser } from "../env";
import { AppError } from "../errors";
import { markSent } from "./documents";
import { MANUAL_SEND_JOB, type ManualSendJobPayload, SEND_DOCUMENT_JOB } from "./email";
import { type ClaimedJob, documentIdOf } from "./jobs";

const { jobs, emailLog, documents, activity } = schema;

/** The most needs_review jobs the list returns. */
const REVIEW_LIST_LIMIT = 50;

/** The send key of a job: the stored manual key, or `job:<id>`. */
export function sendKeyOf(job: Pick<ClaimedJob, "id" | "type" | "payload">): string {
  if (job.type === MANUAL_SEND_JOB) return (job.payload as ManualSendJobPayload).idempotencyKey;
  return `job:${job.id}`;
}

/** The jobs in needs_review, newest first, with their document. */
export async function listReviewJobs(db: Db): Promise<ReviewJobView[]> {
  const rows = await db
    .select({
      id: jobs.id,
      type: jobs.type,
      lastError: jobs.lastError,
      updatedAt: jobs.updatedAt,
      documentId: documents.id,
      documentKind: documents.kind,
      documentNumber: documents.number,
    })
    .from(jobs)
    .leftJoin(documents, sql`${documents.id} = json_extract(${jobs.payload}, '$.documentId')`)
    .where(eq(jobs.status, "needs_review"))
    .orderBy(desc(jobs.updatedAt), jobs.id)
    .limit(REVIEW_LIST_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
    documentId: row.documentId,
    documentKind: row.documentKind,
    documentNumber: row.documentNumber,
  }));
}

/** Loads a job in needs_review. 404 if missing, 409 if it is in another state. */
async function loadReviewJob(db: Db, jobId: string): Promise<ClaimedJob> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new AppError(404, "job_not_found", "This job does not exist");
  if (job.status !== "needs_review") throw notInReview();
  return job;
}

const notInReview = () =>
  new AppError(409, "job_not_in_review", "This email no longer needs review. Reload the page.");

async function documentOf(db: Db, job: ClaimedJob) {
  const documentId = documentIdOf(job.payload);
  if (!documentId) return null;
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  return doc ?? null;
}

/** The activity row of a resolution: the acting Owner and the job state before it. */
function resolutionActivity(
  db: Db,
  input: {
    job: ClaimedJob;
    doc: { id: string; clientId: string } | null;
    type: "email_marked_sent" | "email_sent_again";
    actor: AuthUser;
    now: number;
  },
) {
  return db.insert(activity).values({
    documentId: input.doc?.id ?? null,
    clientId: input.doc?.clientId ?? null,
    type: input.type,
    actorUserId: input.actor.id,
    data: {
      jobId: input.job.id,
      jobType: input.job.type,
      priorStatus: input.job.status,
      idempotencyKey: sendKeyOf(input.job),
    },
    createdAt: input.now,
  });
}

/**
 * "Mark as sent": the Owner checked the provider logs and the email went out. The job is
 * done, its newest `unknown` email_log row becomes `sent` (so the next manual send gets a
 * new key), and a document send moves the document to sent. No provider is called.
 */
export async function markReviewedSent(
  db: Db,
  jobId: string,
  opts: { actor: AuthUser; now: number },
): Promise<void> {
  const job = await loadReviewJob(db, jobId);
  const doc = await documentOf(db, job);
  const [claimed] = await db
    .update(jobs)
    .set({ status: "done", finishedAt: opts.now, updatedAt: opts.now })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "needs_review")))
    .returning({ id: jobs.id });
  if (!claimed) throw notInReview();

  const key = sendKeyOf(job);
  // With a document, the document index finds the row. Without one, the key alone does.
  const newestUnknown = db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(
        doc ? eq(emailLog.documentId, doc.id) : undefined,
        eq(emailLog.idempotencyKey, key),
        eq(emailLog.status, "unknown"),
      ),
    )
    .orderBy(desc(emailLog.createdAt))
    .limit(1);
  await db.batch([
    db.update(emailLog).set({ status: "sent" }).where(inArray(emailLog.id, newestUnknown)),
    resolutionActivity(db, {
      job,
      doc,
      type: "email_marked_sent",
      actor: opts.actor,
      now: opts.now,
    }),
  ]);

  const sendsDocument = job.type === SEND_DOCUMENT_JOB || job.type === MANUAL_SEND_JOB;
  if (sendsDocument && doc && doc.number !== null && doc.status !== "void") {
    const revisionId =
      job.type === MANUAL_SEND_JOB
        ? (job.payload as ManualSendJobPayload).revisionId
        : doc.currentRevisionId;
    if (revisionId) {
      await markSent(db, doc.id, {
        revisionId,
        now: opts.now,
        actor: opts.actor,
        trigger: job.type === MANUAL_SEND_JOB ? "manual" : "auto",
      });
    }
  }
}

/**
 * "Send again": the Owner checked the provider logs and the email did not go out. This
 * releases `plainbooks:<key>` with `expectedState: "unknown"` and queues the job with a
 * fresh attempt count. The job then sends once with the same key. Returns the job ID.
 *
 * Throws 409 `email_already_sent` when mailswitch has a `sent` record for the key (for
 * example after an idempotency conflict): the email went out, so mark it as sent instead.
 */
export async function sendReviewedAgain(
  db: Db,
  jobId: string,
  opts: { actor: AuthUser; now: number },
): Promise<string> {
  const job = await loadReviewJob(db, jobId);
  const doc = await documentOf(db, job);
  const store = new D1IdempotencyStore(db.$client);
  const stored = `${MAILER_NAMESPACE}:${sendKeyOf(job)}`;
  if (!(await store.release(stored, { expectedState: "unknown" }))) {
    // Nothing to release, or the record is in another state.
    const record = await store.get(stored);
    if (record?.state === "sent") {
      throw new AppError(
        409,
        "email_already_sent",
        "The provider accepted this email before. Mark it as sent instead.",
      );
    }
    if (record?.state === "pending") {
      throw new AppError(409, "email_send_in_progress", "This email is being sent now.");
    }
  }

  const [queued] = await db
    .update(jobs)
    .set({
      status: "pending",
      attempts: 0,
      runAfter: opts.now,
      finishedAt: null,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: opts.now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "needs_review")))
    .returning({ id: jobs.id });
  if (!queued) throw notInReview();
  await resolutionActivity(db, {
    job,
    doc,
    type: "email_sent_again",
    actor: opts.actor,
    now: opts.now,
  });
  return queued.id;
}
