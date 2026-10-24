/**
 * The overview screen (U18): one aggregate read with a few grouped queries, so the page
 * needs one request and stays far below the D1 per-request query limit.
 *
 * Outstanding counts invoices that are sent or partially paid with a balance. Drafts,
 * finalized invoices (numbered but not sent, so not billed yet), and void invoices are
 * left out. Home values use each invoice's stored rate: the latest revision's home total
 * minus the home value of its payments and write-offs.
 */
import { sql } from "drizzle-orm";
import type { DocumentKind } from "../../shared/domain";
import type {
  CurrencyOutstanding,
  DashboardData,
  FailedJobView,
  NotificationList,
  NotificationView,
  ReadyToSendItem,
} from "../../shared/schemas/dashboard";
import { dashboardQuery, notificationListQuery } from "../../shared/schemas/dashboard";
import type { ListFilter } from "../../shared/schemas/document";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { listDocuments, loadWorkspace, workspaceToday } from "./documents";
import { nextActiveSchedule } from "./recurring";
import { listSuggestions } from "./reminders";
import { openInvoiceCondition, overdueSql } from "./status-sql";

const NOTIFICATION_LIMIT = 5;
const FAILED_JOB_LIMIT = 10;
const READY_LIMIT = 5;
const RECENT_LIMIT = 10;

/** The open balance of one invoice in the home currency, at its stored rate. */
const HOME_BALANCE = sql.raw(`(r.home_total - COALESCE(
  (SELECT SUM(p.home_amount) FROM payments p WHERE p.document_id = d.id), 0))`);

/** Open invoices: sent or partially paid with a balance above zero. */
const OPEN_INVOICE = sql.raw(openInvoiceCondition("d."));

interface CurrencyRow {
  currency: string;
  amount: number;
  home: number;
  n: number;
}

interface OverdueRow {
  client_name: string;
  home: number;
  n: number;
}

interface CountRow {
  n: number;
}

interface PaidRow {
  home: number | null;
  payments: number;
  invoices: number;
}

interface ReadyRow {
  id: string;
  kind: DocumentKind;
  number: string | null;
  client_name: string;
  currency: string;
  total: number;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  document_id: string | null;
  document_kind: DocumentKind | null;
  created_at: number;
  read_at: number | null;
}

interface JobRow {
  id: string;
  type: string;
  last_error: string | null;
  attempts: number;
  finished_at: number | null;
  payload: string | null;
}

function notificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    documentId: row.document_id,
    documentKind: row.document_kind,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function documentIdOf(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const value = JSON.parse(payload) as { documentId?: unknown };
    return typeof value.documentId === "string" ? value.documentId : null;
  } catch {
    return null;
  }
}

const NOTIFICATION_SELECT = sql.raw(`SELECT n.id, n.type, n.title, n.body, n.document_id,
  d.kind AS document_kind, n.created_at, n.read_at
  FROM notifications n LEFT JOIN documents d ON d.id = n.document_id`);

export async function getDashboard(
  db: Db,
  rawQuery: { recent?: ListFilter | string },
  opts: { now: number },
): Promise<DashboardData> {
  const query = dashboardQuery.parse(rawQuery);
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, opts.now);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [
    currencyRows,
    overdueRows,
    paidRows,
    readyRows,
    readyCount,
    docCount,
    notificationRows,
    unreadCount,
    jobRows,
    failedCount,
    recent,
    needsReminder,
    nextRecurring,
  ] = await Promise.all([
    db.all<CurrencyRow>(sql`SELECT d.currency AS currency, COUNT(*) AS n,
        SUM(d.total - d.amount_paid) AS amount, SUM(${HOME_BALANCE}) AS home
      FROM documents d JOIN document_revisions r ON r.id = d.current_revision_id
      WHERE ${OPEN_INVOICE}
      GROUP BY d.currency`),
    db.all<OverdueRow>(sql`SELECT c.name AS client_name, COUNT(*) AS n,
        SUM(${HOME_BALANCE}) AS home
      FROM documents d
      JOIN document_revisions r ON r.id = d.current_revision_id
      JOIN clients c ON c.id = d.client_id
      WHERE ${overdueSql(today, "d.")}
      GROUP BY d.client_id
      ORDER BY home DESC, c.name`),
    db.all<PaidRow>(sql`SELECT SUM(p.home_amount) AS home, COUNT(*) AS payments,
        COUNT(DISTINCT p.document_id) AS invoices
      FROM payments p JOIN documents d ON d.id = p.document_id
      WHERE p.kind = 'payment' AND d.status <> 'void'
        AND p.paid_on >= ${monthStart} AND p.paid_on <= ${today}`),
    db.all<ReadyRow>(sql`SELECT d.id, d.kind, d.number, c.name AS client_name, d.currency, d.total
      FROM documents d JOIN clients c ON c.id = d.client_id
      WHERE (d.kind = 'invoice' AND d.status = 'finalized')
        OR (d.kind = 'quote' AND d.status = 'draft' AND d.number IS NOT NULL)
      ORDER BY d.updated_at DESC
      LIMIT ${READY_LIMIT}`),
    db.all<CountRow>(sql`SELECT COUNT(*) AS n FROM documents d
      WHERE (d.kind = 'invoice' AND d.status = 'finalized')
        OR (d.kind = 'quote' AND d.status = 'draft' AND d.number IS NOT NULL)`),
    db.all<CountRow>(sql`SELECT COUNT(*) AS n FROM documents`),
    db.all<NotificationRow>(
      sql`${NOTIFICATION_SELECT} WHERE n.read_at IS NULL
        ORDER BY n.created_at DESC, n.rowid DESC LIMIT ${NOTIFICATION_LIMIT}`,
    ),
    db.all<CountRow>(sql`SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL`),
    db.all<JobRow>(sql`SELECT id, type, last_error, attempts, finished_at, payload FROM jobs
      WHERE status = 'failed' ORDER BY finished_at DESC, id LIMIT ${FAILED_JOB_LIMIT}`),
    db.all<CountRow>(sql`SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed'`),
    listDocuments(
      db,
      { kind: "invoice", filter: query.recent, page: 1, pageSize: RECENT_LIMIT },
      { now: opts.now },
    ),
    listSuggestions(db, opts.now),
    nextActiveSchedule(db),
  ]);

  const byCurrency: CurrencyOutstanding[] = currencyRows
    .map((row) => ({
      currency: row.currency,
      amount: Number(row.amount),
      home: Math.max(0, Number(row.home)),
      invoiceCount: Number(row.n),
    }))
    .sort((a, b) => b.home - a.home || a.currency.localeCompare(b.currency));
  const paid = paidRows[0];
  const readyItems: ReadyToSendItem[] = readyRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    number: row.number,
    clientName: row.client_name,
    currency: row.currency,
    total: row.total,
  }));
  const failedItems: FailedJobView[] = jobRows.map((row) => ({
    id: row.id,
    type: row.type,
    lastError: row.last_error,
    attempts: row.attempts,
    finishedAt: row.finished_at,
    documentId: documentIdOf(row.payload),
  }));

  return {
    homeCurrency: ws.homeCurrency,
    today,
    isEmpty: Number(docCount[0]?.n ?? 0) === 0,
    outstanding: {
      home: byCurrency.reduce((sum, row) => sum + row.home, 0),
      invoiceCount: byCurrency.reduce((sum, row) => sum + row.invoiceCount, 0),
      currencyCount: byCurrency.length,
    },
    overdue: {
      home: overdueRows.reduce((sum, row) => sum + Math.max(0, Number(row.home)), 0),
      invoiceCount: overdueRows.reduce((sum, row) => sum + Number(row.n), 0),
      topClientName: overdueRows[0]?.client_name ?? null,
    },
    paidThisMonth: {
      home: Number(paid?.home ?? 0),
      paymentCount: Number(paid?.payments ?? 0),
      invoiceCount: Number(paid?.invoices ?? 0),
    },
    nextRecurring,
    byCurrency,
    readyToSend: { count: Number(readyCount[0]?.n ?? 0), items: readyItems },
    recent: recent.items,
    needsReminder,
    notifications: {
      unreadCount: Number(unreadCount[0]?.n ?? 0),
      items: notificationRows.map(notificationView),
    },
    failedJobs: { count: Number(failedCount[0]?.n ?? 0), items: failedItems },
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function listNotifications(
  db: Db,
  rawQuery: Record<string, unknown>,
): Promise<NotificationList> {
  const query = notificationListQuery.parse(rawQuery);
  const where = query.state === "unread" ? sql`WHERE n.read_at IS NULL` : sql``;
  const [rows, total, unread] = await Promise.all([
    db.all<NotificationRow>(
      sql`${NOTIFICATION_SELECT} ${where} ORDER BY n.created_at DESC, n.rowid DESC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ),
    db.all<CountRow>(sql`SELECT COUNT(*) AS n FROM notifications n ${where}`),
    db.all<CountRow>(sql`SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL`),
  ]);
  return {
    items: rows.map(notificationView),
    total: Number(total[0]?.n ?? 0),
    unreadCount: Number(unread[0]?.n ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Dismisses one notification. Dismissing it again is a no-op. */
export async function dismissNotification(db: Db, id: string, now: number): Promise<void> {
  const rows = await db.all<{ id: string }>(
    sql`UPDATE notifications SET read_at = COALESCE(read_at, ${now}) WHERE id = ${id} RETURNING id`,
  );
  if (rows.length === 0) {
    throw new AppError(404, "notification_not_found", "This notification does not exist");
  }
}

/** Dismisses every notification. Returns how many were open. */
export async function dismissAllNotifications(db: Db, now: number): Promise<number> {
  const rows = await db.all<{ id: string }>(
    sql`UPDATE notifications SET read_at = ${now} WHERE read_at IS NULL RETURNING id`,
  );
  return rows.length;
}
