import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  AgingReport,
  ExportType,
  IncomeReport,
  ReportPeriod,
  TaxSummary,
} from "../../../shared/schemas/report";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

export interface ReportFilters {
  period: ReportPeriod;
  from?: string;
  to?: string;
}

function rangeQuery(filters: ReportFilters) {
  return { period: filters.period, from: filters.from, to: filters.to };
}

export function useTaxSummary(filters: ReportFilters, enabled: boolean) {
  const query = rangeQuery(filters);
  return useQuery({
    queryKey: queryKeys.reports.view("tax-summary", query),
    queryFn: () => api<TaxSummary>("/reports/tax-summary", { query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useIncomeReport(filters: ReportFilters, enabled: boolean) {
  const query = rangeQuery(filters);
  return useQuery({
    queryKey: queryKeys.reports.view("income", query),
    queryFn: () => api<IncomeReport>("/reports/income", { query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAgingReport(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reports.view("aging", {}),
    queryFn: () => api<AgingReport>("/reports/aging"),
    enabled,
  });
}

/** The URL of a CSV export. The browser streams it straight to a file. */
export function exportUrl(type: ExportType, filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (type !== "clients") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  const text = params.toString();
  return `/api/reports/export/${type}${text ? `?${text}` : ""}`;
}
