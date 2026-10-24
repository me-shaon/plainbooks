import { useNavigate } from "@tanstack/react-router";
import { ChartColumn, Download } from "lucide-react";
import type { ReactNode } from "react";
import { formatGrouped } from "../../../shared/money";
import {
  AGING_BUCKET_LABELS,
  AGING_BUCKETS,
  type AgingReport,
  type ExportType,
  type IncomeReport,
  periodLabel,
  REPORT_PERIOD_LABELS,
  REPORT_PERIODS,
  type ReportPeriod,
  type TaxSummary,
} from "../../../shared/schemas/report";
import { KpiCard, KpiGrid } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { IsoDatePicker } from "../../components/ui/date-picker";
import { EmptyState } from "../../components/ui/empty-state";
import { Menu, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { Segment, SegmentedControl } from "../../components/ui/segmented-control";
import { Skeleton } from "../../components/ui/skeleton";
import { StackedList, StackedRow } from "../../components/ui/stacked-list";
import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableContainer,
  TableHeader,
} from "../../components/ui/table";
import { Tab, TabList, TabPanel, Tabs } from "../../components/ui/tabs";
import { formatDate } from "../../lib/format";
import {
  exportUrl,
  type ReportFilters,
  useAgingReport,
  useIncomeReport,
  useTaxSummary,
} from "./queries";

export const REPORT_TABS = ["tax", "income", "aging"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export interface ReportsSearch {
  tab?: ReportTab;
  period?: ReportPeriod;
  from?: string;
  to?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validateReportsSearch(search: Record<string, unknown>): ReportsSearch {
  const pick = <T extends string>(value: unknown, options: readonly T[]) =>
    options.find((o) => o === value);
  const date = (value: unknown) =>
    typeof value === "string" && ISO.test(value) ? value : undefined;
  return {
    tab: pick(search.tab, REPORT_TABS),
    period: pick(search.period, REPORT_PERIODS),
    from: date(search.from),
    to: date(search.to),
  };
}

const EXPORTS: { id: ExportType; label: string; note: string }[] = [
  { id: "invoices", label: "Invoices", note: "Issued in the date range" },
  { id: "payments", label: "Payments", note: "Paid in the date range" },
  { id: "clients", label: "Clients", note: "Every client" },
];

/** A home currency figure without the code. The column header names the currency. */
function Figure({ minor, currency }: { minor: number; currency: string }) {
  return <span className="figure">{formatGrouped(minor, currency)}</span>;
}

function download(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.click();
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function NoRows({ children }: { children: ReactNode }) {
  return <EmptyState icon={ChartColumn} title="Nothing to report" description={children} />;
}

function TaxPanel({ data }: { data: TaxSummary }) {
  const cur = data.homeCurrency;
  if (data.rows.length === 0) {
    return <NoRows>No sent invoices with tax were issued in this range.</NoRows>;
  }
  return (
    <>
      <KpiGrid>
        <KpiCard
          variant="hero"
          label="Tax in range"
          value={`${cur} ${formatGrouped(data.total.tax, cur)}`}
          note={`On ${cur} ${formatGrouped(data.total.taxable, cur)} taxable`}
        />
        {data.totals.map((t) => (
          <KpiCard
            key={`${t.taxRateId}:${t.rate}`}
            label={t.name}
            value={`${cur} ${formatGrouped(t.tax, cur)}`}
            note={`${t.invoiceCount} ${t.invoiceCount === 1 ? "invoice" : "invoices"}`}
          />
        ))}
      </KpiGrid>
      <TableContainer className="hidden md:block">
        <Table aria-label="Tax by rate and period">
          <TableHeader>
            <Column isRowHeader>Period</Column>
            <Column>Tax rate</Column>
            <Column align="end">Invoices</Column>
            <Column align="end">Taxable ({cur})</Column>
            <Column align="end">Tax ({cur})</Column>
          </TableHeader>
          <TableBody
            items={data.rows.map((r) => ({ ...r, id: `${r.period}:${r.taxRateId}:${r.rate}` }))}
          >
            {(row) => (
              <Row id={row.id}>
                <Cell>{periodLabel(row.period)}</Cell>
                <Cell>
                  {row.name} <span className="text-muted-foreground">({row.rate}%)</span>
                </Cell>
                <Cell align="end">
                  <span className="figure">{row.invoiceCount}</span>
                </Cell>
                <Cell align="end">
                  <Figure minor={row.taxable} currency={cur} />
                </Cell>
                <Cell align="end">
                  <Figure minor={row.tax} currency={cur} />
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <StackedList label="Tax by rate and period" className="md:hidden">
        {data.rows.map((row) => (
          <StackedRow
            key={`${row.period}:${row.taxRateId}:${row.rate}`}
            title={`${periodLabel(row.period)} · ${row.name}`}
            meta={`Taxable ${cur} ${formatGrouped(row.taxable, cur)}`}
            value={<Figure minor={row.tax} currency={cur} />}
          />
        ))}
      </StackedList>
    </>
  );
}

function IncomePanel({ data }: { data: IncomeReport }) {
  const cur = data.homeCurrency;
  if (data.rows.length === 0) return <NoRows>No sent invoices were issued in this range.</NoRows>;
  const money = (minor: number) => `${cur} ${formatGrouped(minor, cur)}`;
  return (
    <>
      <KpiGrid>
        <KpiCard variant="hero" label="Invoiced" value={money(data.total.invoiced)} />
        <KpiCard label="Paid" value={money(data.total.paid)} />
        <KpiCard
          label="Still open"
          value={money(data.total.open)}
          note={
            data.total.writtenOff > 0 ? `${money(data.total.writtenOff)} written off` : undefined
          }
        />
      </KpiGrid>
      <TableContainer className="hidden md:block">
        <Table aria-label="Income by client and period">
          <TableHeader>
            <Column isRowHeader>Period</Column>
            <Column>Client</Column>
            <Column align="end">Invoices</Column>
            <Column align="end">Invoiced ({cur})</Column>
            <Column align="end">Paid ({cur})</Column>
            <Column align="end">Open ({cur})</Column>
          </TableHeader>
          <TableBody items={data.rows.map((r) => ({ ...r, id: `${r.period}:${r.clientId}` }))}>
            {(row) => (
              <Row id={row.id}>
                <Cell>{periodLabel(row.period)}</Cell>
                <Cell>
                  <span className="font-medium">{row.clientName}</span>
                </Cell>
                <Cell align="end">
                  <span className="figure">{row.invoiceCount}</span>
                </Cell>
                <Cell align="end">
                  <Figure minor={row.invoiced} currency={cur} />
                </Cell>
                <Cell align="end">
                  <Figure minor={row.paid} currency={cur} />
                </Cell>
                <Cell align="end">
                  <Figure minor={row.open} currency={cur} />
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <StackedList label="Income by client and period" className="md:hidden">
        {data.rows.map((row) => (
          <StackedRow
            key={`${row.period}:${row.clientId}`}
            title={row.clientName}
            meta={`${periodLabel(row.period)} · paid ${cur} ${formatGrouped(row.paid, cur)}`}
            value={<Figure minor={row.invoiced} currency={cur} />}
          />
        ))}
      </StackedList>
    </>
  );
}

function AgingPanel({ data }: { data: AgingReport }) {
  const cur = data.homeCurrency;
  return (
    <>
      <p className="m-0 text-[13px] text-muted-foreground">
        Open balances by days past the due date, as of {formatDate(data.asOf)}.
      </p>
      <KpiGrid className="grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
        {AGING_BUCKETS.map((bucket, i) => (
          <KpiCard
            key={bucket}
            variant={i === 0 ? "hero" : "default"}
            label={AGING_BUCKET_LABELS[bucket]}
            value={`${cur} ${formatGrouped(data.totals[bucket], cur)}`}
          />
        ))}
      </KpiGrid>
      {data.rows.length === 0 ? (
        <NoRows>No invoices have an open balance.</NoRows>
      ) : (
        <>
          <TableContainer className="hidden md:block">
            <Table aria-label="Aging by client">
              <TableHeader>
                <Column isRowHeader>Client</Column>
                {AGING_BUCKETS.map((bucket) => (
                  <Column key={bucket} align="end">
                    {AGING_BUCKET_LABELS[bucket]}
                  </Column>
                ))}
                <Column align="end">Total ({cur})</Column>
              </TableHeader>
              <TableBody items={data.rows.map((r) => ({ ...r, id: r.clientId }))}>
                {(row) => (
                  <Row id={row.id}>
                    <Cell>
                      <span className="font-medium">{row.clientName}</span>
                    </Cell>
                    {AGING_BUCKETS.map((bucket) => (
                      <Cell key={bucket} align="end">
                        <Figure minor={row.buckets[bucket]} currency={cur} />
                      </Cell>
                    ))}
                    <Cell align="end">
                      <span className="font-medium">
                        <Figure minor={row.total} currency={cur} />
                      </span>
                    </Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <StackedList label="Aging by client" className="md:hidden">
            {data.rows.map((row) => {
              const late = row.total - row.buckets.current;
              return (
                <StackedRow
                  key={row.clientId}
                  title={row.clientName}
                  meta={late > 0 ? `${cur} ${formatGrouped(late, cur)} overdue` : "Nothing overdue"}
                  value={<Figure minor={row.total} currency={cur} />}
                />
              );
            })}
          </StackedList>
        </>
      )}
    </>
  );
}

export function ReportsPage({ search }: { search: ReportsSearch }) {
  const navigate = useNavigate({ from: "/reports/" });
  const tab = search.tab ?? "tax";
  const filters: ReportFilters = {
    period: search.period ?? "month",
    from: search.from,
    to: search.to,
  };
  const rangeError =
    filters.from && filters.to && filters.from > filters.to
      ? "The start date must be on or before the end date"
      : undefined;
  const tax = useTaxSummary(filters, tab === "tax" && !rangeError);
  const income = useIncomeReport(filters, tab === "income" && !rangeError);
  const aging = useAgingReport(tab === "aging");
  const range = tab === "tax" ? tax.data : tab === "income" ? income.data : undefined;

  const set = (next: Partial<ReportsSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  const exportMenu = (
    <MenuTrigger>
      <Button variant="secondary">
        <Download className="size-4" aria-hidden="true" />
        Export
      </Button>
      <Menu
        aria-label="Export as CSV"
        onAction={(key) => download(exportUrl(key as ExportType, filters))}
      >
        {EXPORTS.map((item) => (
          <MenuItem key={item.id} id={item.id} textValue={`${item.label} CSV`}>
            <span className="flex flex-col">
              <span>{item.label} CSV</span>
              <span className="text-xs text-muted-foreground">{item.note}</span>
            </span>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );

  const filterBar = (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <SegmentedControl
        aria-label="Group by"
        selectedKey={filters.period}
        onSelectionChange={(key) =>
          set({ period: key === "month" ? undefined : (key as ReportPeriod) })
        }
      >
        {REPORT_PERIODS.map((p) => (
          <Segment key={p} id={p}>
            {REPORT_PERIOD_LABELS[p]}
          </Segment>
        ))}
      </SegmentedControl>
      <div className="flex flex-col gap-3 sm:flex-row">
        <IsoDatePicker
          label="From"
          className="w-full sm:w-48"
          value={filters.from ?? range?.from ?? null}
          onChange={(value) => set({ from: value ?? undefined })}
          isInvalid={Boolean(rangeError)}
          errorMessage={rangeError}
        />
        <IsoDatePicker
          label="To"
          className="w-full sm:w-48"
          value={filters.to ?? range?.to ?? null}
          onChange={(value) => set({ to: value ?? undefined })}
        />
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Accrual basis by issue date. Amounts are in the home currency at each invoice's stored rate."
        actions={exportMenu}
      />
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => set({ tab: key === "tax" ? undefined : (key as ReportTab) })}
      >
        <TabList aria-label="Reports">
          <Tab id="tax">Tax summary</Tab>
          <Tab id="income">Income</Tab>
          <Tab id="aging">Aging</Tab>
        </TabList>
        <TabPanel id="tax">
          {filterBar}
          {rangeError ? null : tax.data ? <TaxPanel data={tax.data} /> : <LoadingRows />}
        </TabPanel>
        <TabPanel id="income">
          {filterBar}
          {rangeError ? null : income.data ? <IncomePanel data={income.data} /> : <LoadingRows />}
        </TabPanel>
        <TabPanel id="aging">
          {aging.data ? <AgingPanel data={aging.data} /> : <LoadingRows />}
        </TabPanel>
      </Tabs>
    </>
  );
}
