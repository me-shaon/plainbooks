// U4: emails whose send ended `unknown` wait in needs_review until an Owner marks them sent
// or sends them again.
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReviewJobView } from "../../src/shared/schemas/dashboard";
import type { DocumentDetail, DocumentSummary } from "../../src/shared/schemas/document";
import { schema } from "../../src/worker/db/client";
import {
  MANUAL_SEND_JOB,
  registerEmailJobHandlers,
  SEND_DOCUMENT_JOB,
  sendDocument,
} from "../../src/worker/services/email";
import { markReviewedSent, sendReviewedAgain } from "../../src/worker/services/email-review";
import { claimJobs, enqueue, runJobById } from "../../src/worker/services/jobs";
import { setPdfRendererForTesting } from "../../src/worker/services/pdf";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";
import { db, draft, NOW, noFetch, resetDocuments, seedClient } from "../helpers/documents";
import {
  type FakeEmail,
  useFakeEmail as installFakeEmail,
  resetEmailState,
  restoreEmail,
} from "../helpers/email";
import { resetPdfState, stubRenderer } from "../helpers/pdf";

const OWNER = "owner@review.test";
const MEMBER = "member@review.test";
const UNKNOWN = {
  status: "unknown",
  reason: "timeout",
  message: "The request timed out.",
} as const;

let clientId: string;
let ownerId: string;
let email: FakeEmail;

interface JobRow {
  id: string;
  type: string;
  status: string;
  attempts: number;
  payload: string;
  last_error: string | null;
  idempotency_key: string;
}

async function jobRows(): Promise<JobRow[]> {
  const rows = await env.DB.prepare(
    "SELECT id, type, status, attempts, payload, last_error, idempotency_key FROM jobs ORDER BY created_at",
  ).all<JobRow>();
  return rows.results;
}

async function jobRow(id: string): Promise<JobRow | null> {
  return env.DB.prepare(
    "SELECT id, type, status, attempts, payload, last_error, idempotency_key FROM jobs WHERE id = ?",
  )
    .bind(id)
    .first<JobRow>();
}

async function docStatus(id: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT status FROM documents WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  return row?.status;
}

async function notifications() {
  const rows = await env.DB.prepare(
    "SELECT type, title, body, document_id FROM notifications ORDER BY created_at, rowid",
  ).all<{ type: string; title: string; body: string; document_id: string | null }>();
  return rows.results;
}

async function idempotencyRecords() {
  const rows = await env.DB.prepare(
    "SELECT key, state FROM mailswitch_idempotency ORDER BY key",
  ).all<{ key: string; state: string }>();
  return rows.results;
}

async function reviewActivity(documentId: string) {
  const rows = await env.DB.prepare(
    `SELECT type, actor_user_id, data FROM activity
     WHERE document_id = ? AND type IN ('email_marked_sent', 'email_sent_again')`,
  )
    .bind(documentId)
    .all<{ type: string; actor_user_id: string | null; data: string }>();
  return rows.results.map((r) => ({ ...r, data: JSON.parse(r.data) as Record<string, unknown> }));
}

/** A manual send through the API that ends `unknown`. Returns the document and its job. */
async function unclearManualSend(): Promise<{ id: string; job: JobRow }> {
  email = await installFakeEmail({ primary: { outcomes: [UNKNOWN] } });
  const id = await draft({ clientId });
  const res = await apiFetch(`/api/documents/${id}/send`, { as: OWNER, method: "POST", json: {} });
  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({ code: "email_needs_review" });
  const [job] = await jobRows();
  if (!job) throw new Error("no needs-review job");
  return { id, job };
}

/** An auto-send job that ends `unknown`. */
async function unclearJob(): Promise<{ id: string; jobId: string }> {
  email = await installFakeEmail({ primary: { outcomes: [UNKNOWN] } });
  const id = await draft({ clientId });
  const job = await enqueue(
    db,
    { type: SEND_DOCUMENT_JOB, payload: { documentId: id }, idempotencyKey: `auto:${id}` },
    NOW,
  );
  expect(await runJobById(env, job.id, NOW)).toBe("needs_review");
  return { id, jobId: job.id };
}

/**
 * Waits until a queued job has run. The route may run it after the response with
 * runJobSoon, so this runs it here only when nothing else has claimed it.
 */
async function settle(jobId: string): Promise<JobRow | null> {
  for (let i = 0; i < 50; i++) {
    await runJobById(env, jobId, Date.now());
    const row = await jobRow(jobId);
    if (row && row.status !== "pending" && row.status !== "running") return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return jobRow(jobId);
}

const post = (path: string, as = OWNER) => apiFetch(path, { as, method: "POST", json: {} });

beforeAll(() => {
  registerEmailJobHandlers();
});

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await clearUsers();
  ownerId = (await seedUser(OWNER, "owner")).id;
  await seedUser(MEMBER, "member");
  clientId = (await seedClient()).id;
  await db
    .insert(schema.clientContacts)
    .values({ clientId, email: "billing@northwind.test", isBilling: true });
  setPdfRendererForTesting(stubRenderer());
});

afterEach(() => {
  setPdfRendererForTesting(null);
  restoreEmail();
});

describe("a manual send that ends unknown", () => {
  it("creates a document_send job in needs_review with the document, revision, and key", async () => {
    const { id, job } = await unclearManualSend();
    const payload = JSON.parse(job.payload) as Record<string, unknown>;
    expect(job).toMatchObject({
      type: MANUAL_SEND_JOB,
      status: "needs_review",
      idempotency_key: `review:document:${id}:send:0`,
    });
    expect(payload).toMatchObject({
      documentId: id,
      idempotencyKey: `document:${id}:send:0`,
      recipients: ["ap@northwind.test", "billing@northwind.test"],
    });
    const revision = await env.DB.prepare(
      "SELECT current_revision_id AS r FROM documents WHERE id = ?",
    )
      .bind(id)
      .first<{ r: string }>();
    expect(payload.revisionId).toBe(revision?.r);
    expect(job.last_error).toBe("tosend unknown/timeout: The request timed out.");
  });

  it("notifies the Owner with the provider, the time, and the reason", async () => {
    const { id } = await unclearManualSend();
    const [note, ...rest] = await notifications();
    expect(rest).toHaveLength(0);
    expect(note).toMatchObject({
      type: "job_needs_review",
      title: "An email needs review",
      document_id: id,
    });
    expect(note?.body).toContain("Provider: tosend.");
    expect(note?.body).toMatch(/Time: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\./);
    expect(note?.body).toContain("Reason: timeout (The request timed out.)");
    expect(note?.body).toContain("mark it as sent or send it again");
  });

  it("a second click reuses the job and adds no notification", async () => {
    const { id } = await unclearManualSend();
    const res = await post(`/api/documents/${id}/send`);
    expect(res.status).toBe(502);
    expect(await jobRows()).toHaveLength(1);
    expect(await notifications()).toHaveLength(1);
    expect(email.primary.sends).toHaveLength(1);
  });

  it("is never claimed by the scheduler", async () => {
    const { job } = await unclearManualSend();
    expect(await runJobById(env, job.id, NOW + 24 * 60 * 60_000)).toBeNull();
    expect(await claimJobs(db, { owner: "tick", now: NOW + 24 * 60 * 60_000 })).toEqual([]);
    expect((await jobRow(job.id))?.status).toBe("needs_review");
  });

  it("shows a Needs review badge on the document and its list row, and lists the job", async () => {
    const { id, job } = await unclearManualSend();
    const detail = (await (
      await apiFetch(`/api/documents/${id}`, { as: MEMBER })
    ).json()) as DocumentDetail;
    expect(detail).toMatchObject({ needsReview: true, reviewJobId: job.id });
    const list = (await (await apiFetch("/api/documents?kind=invoice", { as: MEMBER })).json()) as {
      items: DocumentSummary[];
    };
    expect(list.items.find((d) => d.id === id)?.needsReview).toBe(true);

    const res = await apiFetch("/api/jobs/needs-review", { as: MEMBER });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: ReviewJobView[] };
    expect(items).toEqual([
      expect.objectContaining({
        id: job.id,
        type: MANUAL_SEND_JOB,
        documentId: id,
        documentKind: "invoice",
        documentNumber: "INV-0001",
      }),
    ]);
  });
});

describe("Mark as sent", () => {
  it("moves the document to sent without a provider call", async () => {
    const { id, job } = await unclearManualSend();
    const res = await post(`/api/jobs/${job.id}/mark-sent`);
    expect(res.status).toBe(200);
    expect(await docStatus(id)).toBe("sent");
    expect(email.primary.sends).toHaveLength(1);
    expect((await jobRow(job.id))?.status).toBe("done");
    const log = await env.DB.prepare("SELECT status FROM email_log WHERE document_id = ?")
      .bind(id)
      .all<{ status: string }>();
    expect(log.results.map((r) => r.status)).toEqual(["sent"]);
  });

  it("writes an activity row with the acting Owner and the prior job status", async () => {
    const { id, job } = await unclearManualSend();
    await post(`/api/jobs/${job.id}/mark-sent`);
    expect(await reviewActivity(id)).toEqual([
      {
        type: "email_marked_sent",
        actor_user_id: ownerId,
        data: expect.objectContaining({
          jobId: job.id,
          jobType: MANUAL_SEND_JOB,
          priorStatus: "needs_review",
          idempotencyKey: `document:${id}:send:0`,
        }),
      },
    ]);
  });

  it("clears the badge, and the next manual send uses a new key", async () => {
    const { id, job } = await unclearManualSend();
    await post(`/api/jobs/${job.id}/mark-sent`);
    const detail = (await (
      await apiFetch(`/api/documents/${id}`, { as: OWNER })
    ).json()) as DocumentDetail;
    expect(detail).toMatchObject({ needsReview: false, reviewJobId: null });

    const res = await post(`/api/documents/${id}/send`);
    expect(res.status).toBe(200);
    expect(email.messages().map((m) => m.idempotencyKey)).toEqual([
      `document:${id}:send:0`,
      `document:${id}:send:1`,
    ]);
  });

  it("resolves an auto-send job: the document is sent with no provider call", async () => {
    const { id, jobId } = await unclearJob();
    await markReviewedSent(db, jobId, {
      actor: { id: ownerId, email: OWNER, name: null, role: "owner" },
      now: NOW + 1000,
    });
    expect(await docStatus(id)).toBe("sent");
    expect(email.primary.sends).toHaveLength(1);
    expect((await jobRow(jobId))?.status).toBe("done");
  });
});

describe("Send again", () => {
  it("releases plainbooks:document:<id>:send:<n> and sends once", async () => {
    const { id, job } = await unclearManualSend();
    expect(await idempotencyRecords()).toEqual([
      { key: `plainbooks:document:${id}:send:0`, state: "unknown" },
    ]);
    const res = await post(`/api/jobs/${job.id}/send-again`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: job.id, status: "pending" });

    expect((await settle(job.id))?.status).toBe("done");
    expect(email.primary.sends).toHaveLength(2);
    expect(email.messages()[1]?.idempotencyKey).toBe(`document:${id}:send:0`);
    expect(await idempotencyRecords()).toEqual([
      { key: `plainbooks:document:${id}:send:0`, state: "sent" },
    ]);
    expect(await docStatus(id)).toBe("sent");
    // A later run of the same job sends nothing more.
    await env.DB.prepare("UPDATE jobs SET status = 'pending' WHERE id = ?").bind(job.id).run();
    expect(await runJobById(env, job.id, Date.now())).toBe("done");
    expect(email.primary.sends).toHaveLength(2);
  });

  it("writes an activity row with the acting Owner and the prior job status", async () => {
    const { id, job } = await unclearManualSend();
    await post(`/api/jobs/${job.id}/send-again`);
    await settle(job.id);
    expect(await reviewActivity(id)).toEqual([
      {
        type: "email_sent_again",
        actor_user_id: ownerId,
        data: expect.objectContaining({ jobId: job.id, priorStatus: "needs_review" }),
      },
    ]);
  });

  it("releases plainbooks:job:<id> for an auto-send job, and the next run sends once", async () => {
    const { id, jobId } = await unclearJob();
    expect(await idempotencyRecords()).toEqual([
      { key: `plainbooks:job:${jobId}`, state: "unknown" },
    ]);
    const actor = { id: ownerId, email: OWNER, name: null, role: "owner" } as const;
    await sendReviewedAgain(db, jobId, { actor, now: NOW + 1000 });
    expect(await jobRow(jobId)).toMatchObject({ status: "pending", attempts: 0 });
    expect(await idempotencyRecords()).toEqual([]);

    expect(await runJobById(env, jobId, NOW + 2000)).toBe("done");
    expect(email.primary.sends).toHaveLength(2);
    expect(await docStatus(id)).toBe("sent");
  });

  it("an unclear result again moves the job back to needs review and notifies the Owner", async () => {
    const { jobId } = await unclearJob();
    email = await installFakeEmail({ primary: { outcomes: [UNKNOWN] } });
    const actor = { id: ownerId, email: OWNER, name: null, role: "owner" } as const;
    await sendReviewedAgain(db, jobId, { actor, now: NOW + 1000 });
    expect(await runJobById(env, jobId, NOW + 2000)).toBe("needs_review");
    expect(await notifications()).toHaveLength(2);
  });

  it("refuses when mailswitch holds a sent record for the key", async () => {
    const { jobId } = await unclearJob();
    await env.DB.prepare("UPDATE mailswitch_idempotency SET state = 'sent' WHERE key = ?")
      .bind(`plainbooks:job:${jobId}`)
      .run();
    const res = await post(`/api/jobs/${jobId}/send-again`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "email_already_sent" });
    expect((await jobRow(jobId))?.status).toBe("needs_review");
  });
});

describe("access and state checks", () => {
  it("gives a Member 403 on both actions and changes nothing", async () => {
    const { id, job } = await unclearManualSend();
    expect((await post(`/api/jobs/${job.id}/mark-sent`, MEMBER)).status).toBe(403);
    expect((await post(`/api/jobs/${job.id}/send-again`, MEMBER)).status).toBe(403);
    expect((await jobRow(job.id))?.status).toBe("needs_review");
    expect(await docStatus(id)).toBe("finalized");
    expect(await idempotencyRecords()).toHaveLength(1);
    expect(await reviewActivity(id)).toEqual([]);
  });

  it("returns 409 for a job that is not in review and 404 for a missing job", async () => {
    const { job } = await unclearManualSend();
    expect((await post(`/api/jobs/${job.id}/mark-sent`)).status).toBe(200);
    const again = await post(`/api/jobs/${job.id}/mark-sent`);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "job_not_in_review" });
    expect((await post(`/api/jobs/${job.id}/send-again`)).status).toBe(409);
    expect((await post("/api/jobs/missing/mark-sent")).status).toBe(404);
  });

  it("a job send never makes a second review row", async () => {
    const { jobId } = await unclearJob();
    expect(await jobRows()).toEqual([
      expect.objectContaining({ id: jobId, type: SEND_DOCUMENT_JOB }),
    ]);
  });

  it("a direct sendDocument with a job key leaves review to the job runner", async () => {
    email = await installFakeEmail({ primary: { outcomes: [UNKNOWN] } });
    const id = await draft({ clientId });
    await expect(
      sendDocument(env, db, id, { now: NOW, fetcher: noFetch, idempotencyKey: "job:x" }),
    ).rejects.toMatchObject({ code: "email_needs_review" });
    expect(await jobRows()).toEqual([]);
  });
});
