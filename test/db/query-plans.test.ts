// Per-request D1 budgets and query plans for the hot paths. Workers Free allows 50 D1
// queries per invocation (one batch() call is one query), and D1 bills rows read, so
// these tests pin the statement count of the heaviest endpoints and check that their
// queries search an index instead of scanning a growing table.
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/worker/app";
import type { Bindings } from "../../src/worker/env";
import { registerEmailJobHandlers } from "../../src/worker/services/email";
import { resetJobRegistryForTesting } from "../../src/worker/services/jobs";
import { recordPayment } from "../../src/worker/services/payments";
import { setPdfRendererForTesting } from "../../src/worker/services/pdf";
import {
  createSchedule,
  registerRecurringJobs,
  setRecurringFetcherForTesting,
} from "../../src/worker/services/recurring";
import { registerReminderJobs } from "../../src/worker/services/reminders";
import { runTick } from "../../src/worker/services/scheduler";
import { buildRequest, clearUsers, seedUser } from "../helpers/auth";
import { countingEnv, queryPlan, type RecordedQuery } from "../helpers/d1";
import {
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  sentInvoice,
} from "../helpers/documents";
import { resetEmailState, restoreEmail, useFakeEmail } from "../helpers/email";
import { resetPdfState, stubRenderer } from "../helpers/pdf";

const OWNER = "owner@plans.test";
let clientId: string;
let sentId: string;
let draftId: string;
let token: string;

/** 10:00 in Asia/Dhaka on 2 November 2026, a :00 tick. */
const TICK = Date.parse("2026-11-02T04:00:00Z");

beforeAll(async () => {
  resetJobRegistryForTesting();
  registerEmailJobHandlers();
  registerRecurringJobs();
  registerReminderJobs();
  await clearUsers();
  await resetDocuments();
  await resetPdfState();
  await resetEmailState();
  await env.DB.prepare(
    `UPDATE workspace SET reminder_mode = 'suggest',
     reminder_schedule = '[{"offsetDays":0},{"offsetDays":7}]'`,
  ).run();
  const owner = await seedUser(OWNER, "owner");
  setPdfRendererForTesting(stubRenderer());
  await useFakeEmail();
  setRecurringFetcherForTesting(noFetch);

  const northwind = await seedClient({ name: "Northwind" });
  const halden = await seedClient({ name: "Halden" });
  clientId = northwind.id;
  for (let i = 0; i < 8; i++) {
    sentId = await sentInvoice({
      clientId: i % 2 ? northwind.id : halden.id,
      issueDate: i % 3 ? "2026-09-01" : "2026-10-20",
      paymentTermsDays: 14,
    });
    if (i % 4 === 0) {
      await recordPayment(db, sentId, { amount: 1000, paidOn: "2026-10-10" }, { now: NOW });
    }
  }
  await sentInvoice({ clientId: northwind.id, kind: "quote" });
  draftId = await draft({ clientId: northwind.id });
  const source = await draft({ clientId: northwind.id });
  await createSchedule(
    db,
    { sourceDocumentId: source, frequency: "monthly", startDate: "2026-11-02" },
    { actor: { id: owner.id, email: OWNER, name: null, role: "owner" }, now: NOW },
  );
  const row = await env.DB.prepare("SELECT public_token AS t FROM documents WHERE id = ?")
    .bind(sentId)
    .first<{ t: string }>();
  token = row?.t ?? "";
});

afterAll(() => {
  setPdfRendererForTesting(null);
  restoreEmail();
  setRecurringFetcherForTesting(null);
  resetJobRegistryForTesting();
});

/** Sends one request through the app with a counting D1 binding. */
async function measure(
  path: string,
  init: { method?: string; json?: unknown } = {},
): Promise<{ status: number; statements: number; queries: RecordedQuery[] }> {
  const { env: counted, counter } = countingEnv();
  const res = await app.fetch(await buildRequest(path, { as: OWNER, ...init }), counted);
  await res.arrayBuffer();
  return { status: res.status, statements: counter.statements, queries: counter.queries };
}

async function measureTick(at: number) {
  const { env: counted, counter } = countingEnv();
  await runTick(counted as Bindings, at);
  return { statements: counter.statements, queries: counter.queries };
}

/** The recorded statement whose SQL matches `pattern`. */
function find(queries: RecordedQuery[], pattern: RegExp): RecordedQuery {
  const query = queries.find((q) => pattern.test(q.sql));
  if (!query) throw new Error(`No statement matches ${pattern}`);
  return query;
}

// Tables that grow with use, and the aliases the raw SQL gives them.
const GROWING = [
  "documents",
  "d",
  "payments",
  "p",
  "document_revisions",
  "r",
  "revision_tax_totals",
  "t",
  "document_lines",
  "jobs",
  "activity",
  "email_log",
];
const FULL_SCAN = new RegExp(`^SCAN (${GROWING.join("|")})\\b`);
/** `EXISTS (SELECT 1 FROM documents)` stops at the first row, so its scan reads one row. */
const ONE_ROW_PROBE = /^SELECT EXISTS \(SELECT 1 FROM documents\)/;

async function fullScans(queries: RecordedQuery[]): Promise<string[]> {
  const found: string[] = [];
  for (const query of queries) {
    if (ONE_ROW_PROBE.test(query.sql)) continue;
    for (const line of await queryPlan(query)) {
      if (FULL_SCAN.test(line)) found.push(`${line}  <-  ${query.sql.replace(/\s+/g, " ")}`);
    }
  }
  return found;
}

const HOT_PATHS: [string, string][] = [
  ["dashboard", "/api/dashboard"],
  ["documents list", "/api/documents?kind=invoice"],
  ["documents list, unpaid", "/api/documents?kind=invoice&filter=unpaid"],
  ["documents list, overdue", "/api/documents?kind=invoice&filter=overdue"],
  ["documents list, drafts", "/api/documents?kind=invoice&filter=drafts"],
  ["documents list, search", "/api/documents?kind=invoice&q=North&page=2&pageSize=5"],
  ["document detail", "/api/documents/:sent"],
  ["document activity", "/api/documents/:sent/activity"],
  ["document reminders", "/api/documents/:sent/reminders"],
  ["tax summary", "/api/reports/tax-summary?period=year"],
  ["income report", "/api/reports/income?period=year"],
  ["aging report", "/api/reports/aging"],
  ["invoice export", "/api/reports/export/invoices?period=year"],
  ["payment export", "/api/reports/export/payments?period=year"],
  ["client detail", "/api/clients/:client"],
  ["reminder suggestions", "/api/reminders/suggestions"],
  ["recurring list", "/api/recurring"],
  ["public page", "/p/:token"],
];

const pathFor = (template: string) =>
  template.replace(":sent", sentId).replace(":client", clientId).replace(":token", token);

describe("statements per request", () => {
  // Measured budgets. A change that adds statements to a hot path must raise these on
  // purpose. All stay far under the 50-query limit. The session read uses 2 statements on
  // every signed-in route: better-auth reads the session, then its user.
  it.each([
    ["/api/dashboard", 19],
    ["/api/documents?kind=invoice", 5],
    ["/api/documents/:sent", 8],
    ["/api/reports/tax-summary?period=year", 4],
    ["/api/reports/income?period=year", 4],
    ["/api/reports/aging", 4],
    ["/api/clients/:client", 9],
    ["/p/:token", 3],
  ])("%s uses at most %i statements", async (path, budget) => {
    const result = await measure(pathFor(path));
    expect(result.status).toBe(200);
    expect(result.statements).toBeLessThanOrEqual(budget);
  });

  it("sends a draft in at most 38 statements, the route's detail read included", async () => {
    const result = await measure(`/api/documents/${draftId}/send`, { method: "POST", json: {} });
    expect(result.status).toBe(200);
    // mailswitch adds 6: the idempotency claim (a batch of 4), one heartbeat, and the
    // final record. The provider row and the send-key count add one each.
    expect(result.statements).toBeLessThanOrEqual(38);
    expect(result.queries.filter((q) => /from "email_providers"/.test(q.sql))).toHaveLength(1);
    // The workspace row is read once per request.
    expect(result.queries.filter((q) => /from "workspace"/.test(q.sql))).toHaveLength(1);
  });

  it("keeps the dashboard count flat as open invoices pass the bound-parameter limit", async () => {
    const before = await measure("/api/dashboard");
    // 120 more open invoices: over the 100 bound parameters one IN list may use.
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 120)
       INSERT INTO documents (id, kind, status, number, client_id, currency, issue_date,
         due_date, total, created_at, updated_at)
       SELECT 'bulk-' || i, 'invoice', 'sent', 'BULK-' || i, ?1, 'BDT', '2026-09-01',
         '2026-09-15', 1000, 0, 0 FROM n`,
    )
      .bind(clientId)
      .run();
    try {
      const after = await measure("/api/dashboard");
      expect(after.status).toBe(200);
      expect(after.statements).toBe(before.statements);
    } finally {
      await env.DB.prepare("DELETE FROM documents WHERE id LIKE 'bulk-%'").run();
    }
  });
});

describe("query plans", () => {
  it.each(HOT_PATHS)("%s searches indexes on growing tables", async (_, path) => {
    const result = await measure(pathFor(path));
    expect(result.status).toBe(200);
    expect(await fullScans(result.queries)).toEqual([]);
  });

  it("the scheduler tick searches indexes on growing tables", async () => {
    const tick = await measureTick(TICK);
    expect(await fullScans(tick.queries)).toEqual([]);
  });

  it("the overdue flag is set and cleared through the due-date and flag indexes", async () => {
    const tick = await measureTick(TICK);
    const set = await queryPlan(find(tick.queries, /SET is_overdue = 1/));
    expect(set.join("\n")).toMatch(
      /SEARCH documents USING INDEX documents_kind_status_due_idx \(kind=\? AND status=\? AND due_date/,
    );
    const clear = await queryPlan(find(tick.queries, /SET is_overdue = 0/));
    expect(clear.join("\n")).toMatch(/SEARCH documents USING INDEX documents_overdue_idx/);
  });

  it("the documents list reads one page in index order, with no sort", async () => {
    const result = await measure("/api/documents?kind=invoice&pageSize=5");
    const plan = await queryPlan(find(result.queries, /order by "documents"."updated_at" desc/));
    expect(plan.join("\n")).toMatch(/USING INDEX documents_kind_updated_idx/);
    expect(plan.join("\n")).not.toMatch(/TEMP B-TREE FOR ORDER BY/);
  });

  it("client detail reads the client's newest documents in index order", async () => {
    const result = await measure(`/api/clients/${clientId}`);
    const plan = await queryPlan(
      find(result.queries, /order by "documents"."created_at" desc limit/),
    );
    expect(plan.join("\n")).toMatch(/USING INDEX documents_client_created_idx/);
    expect(plan.join("\n")).not.toMatch(/TEMP B-TREE FOR ORDER BY/);
  });

  it.each([
    [
      "/api/reports/tax-summary?period=year",
      /FROM revision_tax_totals/,
      "revision_tax_totals_issue_date_idx",
    ],
    ["/api/reports/income?period=year", /AS invoiced/, "document_revisions_issue_date_idx"],
    [
      "/api/reports/export/invoices?period=year",
      /r\.revision_number/,
      "document_revisions_issue_date_idx",
    ],
    ["/api/reports/export/payments?period=year", /FROM payments p/, "payments_paid_on_idx"],
  ])("%s starts from the date index", async (path, pattern, index) => {
    const result = await measure(path);
    const [first] = await queryPlan(find(result.queries, pattern));
    expect(first).toContain(`USING INDEX ${index}`);
  });
});
