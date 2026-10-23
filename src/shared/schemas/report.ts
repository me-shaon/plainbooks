import { z } from "zod";
import { isoDate } from "./document";

export const REPORT_PERIODS = ["month", "quarter", "year"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

/**
 * Report and export query. Dates filter on the invoice issue date (accrual basis). The
 * defaults are the start of the current year and today, in the workspace timezone.
 */
export const reportQuery = z
  .object({
    period: z.enum(REPORT_PERIODS).default("month"),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "The start date must be on or before the end date",
    path: ["from"],
  });
export type ReportQuery = z.input<typeof reportQuery>;

export const EXPORT_TYPES = ["invoices", "payments", "clients"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

interface ReportRange {
  homeCurrency: string;
  period: ReportPeriod;
  from: string;
  to: string;
}

export interface TaxSummaryRow {
  /** "2026-10", "2026-Q3", or "2026". */
  period: string;
  taxRateId: string;
  name: string;
  /** Percent as a decimal string, for example "15". */
  rate: string;
  /** Home currency minor units. */
  taxable: number;
  tax: number;
  invoiceCount: number;
}

export interface TaxSummary extends ReportRange {
  rows: TaxSummaryRow[];
  /** One row per tax rate over the whole range. */
  totals: Omit<TaxSummaryRow, "period">[];
  total: { taxable: number; tax: number };
}

export interface IncomeRow {
  period: string;
  clientId: string;
  clientName: string;
  invoiceCount: number;
  /** Home currency minor units at each invoice's stored rate. */
  invoiced: number;
  paid: number;
  writtenOff: number;
  /** Invoiced minus paid minus written off. */
  open: number;
}

export interface IncomeReport extends ReportRange {
  rows: IncomeRow[];
  total: { invoiced: number; paid: number; writtenOff: number; open: number };
}

export const AGING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  "1_30": "1 to 30 days",
  "31_60": "31 to 60 days",
  "61_90": "61 to 90 days",
  over_90: "Over 90 days",
};

export interface AgingRow {
  clientId: string;
  clientName: string;
  /** Home currency minor units of the open balance, per bucket. */
  buckets: Record<AgingBucket, number>;
  total: number;
  invoiceCount: number;
}

export interface AgingReport {
  homeCurrency: string;
  /** Today in the workspace timezone. */
  asOf: string;
  rows: AgingRow[];
  totals: Record<AgingBucket, number>;
  total: number;
}

/** "2026-10" to "Oct 2026", "2026-Q3" to "Q3 2026", and "2026" stays. */
export function periodLabel(period: string): string {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${names[Number(month[2]) - 1] ?? month[2]} ${month[1]}`;
  }
  return period;
}
