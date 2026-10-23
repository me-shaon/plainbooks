/**
 * Reports (U19). Accrual basis by issue date (R49). Every figure comes from the latest
 * revision of each invoice (`documents.current_revision_id`): the denormalized report
 * columns and the per-rate `revision_tax_totals` rows. No snapshot JSON is parsed.
 *
 * Reported invoices are sent, partially paid, or paid. Drafts, void invoices, and
 * finalized invoices that were never sent are left out of every report and export.
 * Amounts are home currency minor units at each invoice's stored rate.
 */
import { type SQL, sql } from "drizzle-orm";
import { formatMinor } from "../../shared/money";
import {
  AGING_BUCKETS,
  type AgingBucket,
  type AgingReport,
  type ExportType,
  type IncomeReport,
  type ReportPeriod,
  type ReportQuery,
  reportQuery,
  type TaxSummary,
} from "../../shared/schemas/report";
import { todayIn } from "../../shared/time";
import type { Db } from "../db/client";
import { loadWorkspace, workspaceToday } from "./documents";

/** Invoices that count as billed. `d` is documents. */
const REPORTED = sql.raw(`d.kind = 'invoice' AND d.status IN ('sent', 'partially_paid', 'paid')`);

/** The period key of an ISO date column, for example "2026-10", "2026-Q3", or "2026". */
function periodSql(column: string, period: ReportPeriod): SQL {
  if (period === "month") return sql.raw(`substr(${column}, 1, 7)`);
  if (period === "year") return sql.raw(`substr(${column}, 1, 4)`);
  return sql.raw(
    `substr(${column}, 1, 4) || '-Q' || ((CAST(substr(${column}, 6, 2) AS INTEGER) + 2) / 3)`,
  );
}

export interface ResolvedRange {
  homeCurrency: string;
  period: ReportPeriod;
  from: string;
  to: string;
  today: string;
  timeZone: string;
}

/** Parses the query and fills in the default range: 1 January to today. */
export async function resolveRange(
  db: Db,
  rawQuery: ReportQuery | Record<string, unknown>,
  now: number,
): Promise<ResolvedRange> {
  const query = reportQuery.parse(rawQuery);
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, now);
  return {
    homeCurrency: ws.homeCurrency,
    period: query.period,
    from: query.from ?? `${today.slice(0, 4)}-01-01`,
    to: query.to ?? today,
    today,
    timeZone: ws.timezone,
  };
}

const n = (value: unknown) => Number(value ?? 0);

// ---------------------------------------------------------------------------
// Tax summary
// ---------------------------------------------------------------------------

interface TaxRow {
  period: string;
  tax_rate_id: string;
  name: string;
  rate: string;
  taxable: number;
  tax: number;
  invoices: number;
}

export async function taxSummary(
  db: Db,
  rawQuery: ReportQuery | Record<string, unknown>,
  now: number,
): Promise<TaxSummary> {
  const range = await resolveRange(db, rawQuery, now);
  const rows = await db.all<TaxRow>(sql`SELECT ${periodSql("t.issue_date", range.period)} AS period,
      t.tax_rate_id, MAX(t.name) AS name, t.rate,
      SUM(t.home_taxable) AS taxable, SUM(t.home_tax) AS tax,
      COUNT(DISTINCT t.document_id) AS invoices
    FROM revision_tax_totals t
    JOIN documents d ON d.current_revision_id = t.revision_id
    WHERE ${REPORTED} AND t.issue_date >= ${range.from} AND t.issue_date <= ${range.to}
    GROUP BY period, t.tax_rate_id, t.rate
    ORDER BY period, CAST(t.rate AS REAL) DESC, name`);

  const byRate = new Map<string, TaxSummary["totals"][number]>();
  const result = rows.map((row) => {
    const item = {
      period: row.period,
      taxRateId: row.tax_rate_id,
      name: row.name,
      rate: row.rate,
      taxable: n(row.taxable),
      tax: n(row.tax),
      invoiceCount: n(row.invoices),
    };
    const key = `${row.tax_rate_id}:${row.rate}`;
    const total = byRate.get(key) ?? {
      taxRateId: item.taxRateId,
      name: item.name,
      rate: item.rate,
      taxable: 0,
      tax: 0,
      invoiceCount: 0,
    };
    total.taxable += item.taxable;
    total.tax += item.tax;
    total.invoiceCount += item.invoiceCount;
    byRate.set(key, total);
    return item;
  });
  const totals = [...byRate.values()].sort((a, b) => Number(b.rate) - Number(a.rate));
  return {
    homeCurrency: range.homeCurrency,
    period: range.period,
    from: range.from,
    to: range.to,
    rows: result,
    totals,
    total: {
      taxable: totals.reduce((sum, t) => sum + t.taxable, 0),
      tax: totals.reduce((sum, t) => sum + t.tax, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

interface IncomeSqlRow {
  period: string;
  client_id: string;
  client_name: string;
  invoices: number;
  invoiced: number;
  paid: number;
  written_off: number;
}

export async function incomeReport(
  db: Db,
  rawQuery: ReportQuery | Record<string, unknown>,
  now: number,
): Promise<IncomeReport> {
  const range = await resolveRange(db, rawQuery, now);
  const rows =
    await db.all<IncomeSqlRow>(sql`SELECT ${periodSql("r.issue_date", range.period)} AS period,
      d.client_id, c.name AS client_name, COUNT(*) AS invoices,
      SUM(r.home_total) AS invoiced,
      SUM(COALESCE((SELECT SUM(p.home_amount) FROM payments p
        WHERE p.document_id = d.id AND p.kind = 'payment'), 0)) AS paid,
      SUM(COALESCE((SELECT SUM(p.home_amount) FROM payments p
        WHERE p.document_id = d.id AND p.kind = 'write_off'), 0)) AS written_off
    FROM documents d
    JOIN document_revisions r ON r.id = d.current_revision_id
    JOIN clients c ON c.id = d.client_id
    WHERE ${REPORTED} AND r.issue_date >= ${range.from} AND r.issue_date <= ${range.to}
    GROUP BY period, d.client_id
    ORDER BY period, invoiced DESC, c.name`);

  const items = rows.map((row) => {
    const invoiced = n(row.invoiced);
    const paid = n(row.paid);
    const writtenOff = n(row.written_off);
    return {
      period: row.period,
      clientId: row.client_id,
      clientName: row.client_name,
      invoiceCount: n(row.invoices),
      invoiced,
      paid,
      writtenOff,
      open: Math.max(0, invoiced - paid - writtenOff),
    };
  });
  const sum = (key: "invoiced" | "paid" | "writtenOff" | "open") =>
    items.reduce((total, row) => total + row[key], 0);
  return {
    homeCurrency: range.homeCurrency,
    period: range.period,
    from: range.from,
    to: range.to,
    rows: items,
    total: {
      invoiced: sum("invoiced"),
      paid: sum("paid"),
      writtenOff: sum("writtenOff"),
      open: sum("open"),
    },
  };
}

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

interface AgingSqlRow {
  client_id: string;
  client_name: string;
  bucket: AgingBucket;
  amount: number;
  invoices: number;
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
}

/** Open balances by days overdue, as of today in the workspace timezone. */
export async function agingReport(db: Db, now: number): Promise<AgingReport> {
  const ws = await loadWorkspace(db);
  const today = workspaceToday(ws, now);
  const rows = await db.all<AgingSqlRow>(sql`SELECT client_id, client_name, bucket,
      SUM(balance) AS amount, COUNT(*) AS invoices
    FROM (
      SELECT d.client_id, c.name AS client_name,
        r.home_total - COALESCE(
          (SELECT SUM(p.home_amount) FROM payments p WHERE p.document_id = d.id), 0) AS balance,
        CASE
          WHEN d.due_date IS NULL OR d.due_date >= ${today} THEN 'current'
          WHEN julianday(${today}) - julianday(d.due_date) <= 30 THEN '1_30'
          WHEN julianday(${today}) - julianday(d.due_date) <= 60 THEN '31_60'
          WHEN julianday(${today}) - julianday(d.due_date) <= 90 THEN '61_90'
          ELSE 'over_90'
        END AS bucket
      FROM documents d
      JOIN document_revisions r ON r.id = d.current_revision_id
      JOIN clients c ON c.id = d.client_id
      WHERE d.kind = 'invoice' AND d.status IN ('sent', 'partially_paid')
        AND d.total - d.amount_paid > 0
    )
    GROUP BY client_id, bucket`);

  const byClient = new Map<string, AgingReport["rows"][number]>();
  const totals = emptyBuckets();
  for (const row of rows) {
    const amount = Math.max(0, n(row.amount));
    const entry = byClient.get(row.client_id) ?? {
      clientId: row.client_id,
      clientName: row.client_name,
      buckets: emptyBuckets(),
      total: 0,
      invoiceCount: 0,
    };
    entry.buckets[row.bucket] += amount;
    entry.total += amount;
    entry.invoiceCount += n(row.invoices);
    totals[row.bucket] += amount;
    byClient.set(row.client_id, entry);
  }
  const sorted = [...byClient.values()].sort(
    (a, b) => b.total - a.total || a.clientName.localeCompare(b.clientName),
  );
  return {
    homeCurrency: ws.homeCurrency,
    asOf: today,
    rows: sorted,
    totals,
    total: AGING_BUCKETS.reduce((sum, key) => sum + totals[key], 0),
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/** Characters that make a spreadsheet read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell: neutralizes formulas with a leading single quote, then quotes it per
 * RFC 4180 when it holds a comma, a double quote, or a line break.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One CSV record with the RFC 4180 CRLF line ending. */
export function csvRow(cells: (string | number | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

const PAGE = 500;

interface ExportSpec {
  header: string[];
  /** Loads one page of rows as CSV cells. */
  page: (offset: number) => Promise<(string | number | null)[][]>;
}

interface InvoiceExportRow {
  number: string | null;
  status: string;
  client_name: string;
  currency: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  fx_rate: string;
  home_currency: string;
  home_total: number;
  revision_number: number;
}

interface PaymentExportRow {
  paid_on: string;
  number: string | null;
  client_name: string;
  kind: string;
  currency: string;
  amount: number;
  fx_rate: string | null;
  home_amount: number;
  note: string | null;
}

interface ClientExportRow {
  name: string;
  email: string | null;
  default_currency: string;
  tax_id: string | null;
  billing_address: string | null;
  payment_terms_days: number | null;
  archived_at: number | null;
  created_at: number;
}

const money = (minor: number, currency: string) => formatMinor(minor, currency);

function exportSpec(db: Db, type: ExportType, range: ResolvedRange): ExportSpec {
  const home = range.homeCurrency;
  if (type === "invoices") {
    return {
      header: [
        "Number",
        "Status",
        "Client",
        "Currency",
        "Issue date",
        "Due date",
        "Subtotal",
        "Discount",
        "Tax",
        "Total",
        "Paid",
        "Balance",
        "Exchange rate",
        `Total (${home})`,
        "Revision",
      ],
      page: async (offset) => {
        const rows = await db.all<InvoiceExportRow>(sql`SELECT d.number, d.status,
            c.name AS client_name, r.currency, r.issue_date, r.due_date, r.subtotal,
            r.discount_total, r.tax_total, r.total, d.amount_paid, r.fx_rate,
            r.home_currency, r.home_total, r.revision_number
          FROM documents d
          JOIN document_revisions r ON r.id = d.current_revision_id
          JOIN clients c ON c.id = d.client_id
          WHERE ${REPORTED} AND r.issue_date >= ${range.from} AND r.issue_date <= ${range.to}
          ORDER BY r.issue_date, d.number
          LIMIT ${PAGE} OFFSET ${offset}`);
        return rows.map((r) => [
          r.number,
          r.status,
          r.client_name,
          r.currency,
          r.issue_date,
          r.due_date,
          money(r.subtotal, r.currency),
          money(r.discount_total, r.currency),
          money(r.tax_total, r.currency),
          money(r.total, r.currency),
          money(r.amount_paid, r.currency),
          money(Math.max(0, r.total - r.amount_paid), r.currency),
          r.fx_rate,
          money(r.home_total, r.home_currency),
          r.revision_number,
        ]);
      },
    };
  }
  if (type === "payments") {
    return {
      header: [
        "Date",
        "Invoice",
        "Client",
        "Kind",
        "Currency",
        "Amount",
        "Exchange rate",
        `Amount (${home})`,
        "Note",
      ],
      page: async (offset) => {
        const rows = await db.all<PaymentExportRow>(sql`SELECT p.paid_on, d.number,
            c.name AS client_name, p.kind, d.currency, p.amount, d.fx_rate, p.home_amount, p.note
          FROM payments p
          JOIN documents d ON d.id = p.document_id
          JOIN clients c ON c.id = d.client_id
          WHERE ${REPORTED} AND p.paid_on >= ${range.from} AND p.paid_on <= ${range.to}
          ORDER BY p.paid_on, d.number, p.created_at
          LIMIT ${PAGE} OFFSET ${offset}`);
        return rows.map((r) => [
          r.paid_on,
          r.number,
          r.client_name,
          r.kind === "write_off" ? "Write-off" : "Payment",
          r.currency,
          money(r.amount, r.currency),
          r.fx_rate,
          money(r.home_amount, home),
          r.note,
        ]);
      },
    };
  }
  return {
    header: [
      "Name",
      "Primary email",
      "Default currency",
      "Tax ID",
      "Billing address",
      "Payment terms (days)",
      "Archived",
      "Created",
    ],
    page: async (offset) => {
      const rows = await db.all<ClientExportRow>(sql`SELECT c.name,
          (SELECT email FROM client_contacts cc WHERE cc.client_id = c.id
            ORDER BY cc.is_primary DESC, cc.created_at LIMIT 1) AS email,
          c.default_currency, c.tax_id, c.billing_address, c.payment_terms_days,
          c.archived_at, c.created_at
        FROM clients c
        ORDER BY c.name, c.id
        LIMIT ${PAGE} OFFSET ${offset}`);
      return rows.map((r) => [
        r.name,
        r.email,
        r.default_currency,
        r.tax_id,
        r.billing_address,
        r.payment_terms_days,
        r.archived_at ? "Yes" : "No",
        todayIn(range.timeZone, r.created_at),
      ]);
    },
  };
}

/** The download filename, for example "invoices-2026-01-01-to-2026-10-24.csv". */
export function exportFilename(type: ExportType, range: ResolvedRange): string {
  return type === "clients"
    ? `clients-${range.today}.csv`
    : `${type}-${range.from}-to-${range.to}.csv`;
}

/**
 * Streams a CSV export page by page, so a large export never sits in memory. It starts
 * with a UTF-8 byte order mark so spreadsheet apps read non-Latin names correctly.
 */
export function exportCsv(db: Db, type: ExportType, range: ResolvedRange): ReadableStream {
  const spec = exportSpec(db, type, range);
  const encoder = new TextEncoder();
  let offset = 0;
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(`﻿${csvRow(spec.header)}`));
        return;
      }
      const rows = await spec.page(offset);
      offset += rows.length;
      if (rows.length > 0) controller.enqueue(encoder.encode(rows.map(csvRow).join("")));
      if (rows.length < PAGE) controller.close();
    },
  });
}
