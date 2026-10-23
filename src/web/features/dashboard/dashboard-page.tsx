import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, Plus, Send } from "lucide-react";
import { useState } from "react";
import { formatMinor } from "../../../shared/money";
import type { DashboardData } from "../../../shared/schemas/dashboard";
import type { ListFilter } from "../../../shared/schemas/document";
import { KpiCard, KpiGrid } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { Segment, SegmentedControl } from "../../components/ui/segmented-control";
import { Skeleton } from "../../components/ui/skeleton";
import { formatMoney, groupDigits } from "../../lib/format";
import { DocumentTable } from "../documents/document-table";
import { documentPath, LIST_FILTER_OPTIONS } from "../documents/labels";
import { NeedsReminderList } from "../reminders/needs-reminder";
import { CurrencyBar } from "./currency-bar";
import { FailedJobsPanel, NotificationsPanel } from "./notifications";
import { useDashboard } from "./queries";

function isoParts(iso: string): number {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** "Friday 23 October" for the header. */
function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(isoParts(iso));
}

function monthName(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(isoParts(iso));
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(isoParts(iso));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A KPI value with a smaller currency code, so long BDT figures fit the card. */
function HomeValue({ minor, currency }: { minor: number; currency: string }) {
  return (
    <>
      {/* Full opacity: 80% white on the accent hero card fails the 4.5:1 contrast check. */}
      <span className="text-base font-normal">{currency}</span>{" "}
      {groupDigits(formatMinor(minor, currency))}
    </>
  );
}

function Kpis({ data }: { data: DashboardData }) {
  const { outstanding, overdue, paidThisMonth, nextRecurring, homeCurrency } = data;
  return (
    <KpiGrid>
      <KpiCard
        variant="hero"
        label="Outstanding"
        value={<HomeValue minor={outstanding.home} currency={homeCurrency} />}
        note={
          outstanding.invoiceCount === 0
            ? "No open invoices"
            : `${plural(outstanding.currencyCount, "currency", "currencies")}, ${plural(outstanding.invoiceCount, "invoice")}`
        }
      />
      <KpiCard
        label="Overdue"
        value={<HomeValue minor={overdue.home} currency={homeCurrency} />}
        note={
          overdue.invoiceCount === 0
            ? "Nothing is overdue"
            : `${plural(overdue.invoiceCount, "invoice")}${overdue.topClientName ? `, ${overdue.topClientName}` : ""}`
        }
      />
      <KpiCard
        label={`Paid in ${monthName(data.today)}`}
        value={<HomeValue minor={paidThisMonth.home} currency={homeCurrency} />}
        note={
          paidThisMonth.invoiceCount === 0
            ? "No payments yet"
            : plural(paidThisMonth.invoiceCount, "invoice")
        }
      />
      <KpiCard
        label="Next recurring"
        value={nextRecurring ? shortDate(nextRecurring.nextIssueDate) : "None"}
        note={
          nextRecurring
            ? `${nextRecurring.name ?? nextRecurring.clientName}, ${formatMoney(nextRecurring.total, nextRecurring.currency)}`
            : "No active schedules"
        }
      />
    </KpiGrid>
  );
}

function ReadyToSend({ data }: { data: DashboardData }) {
  const { count, items } = data.readyToSend;
  if (count === 0) return null;
  return (
    <section
      aria-labelledby="ready-title"
      className="flex flex-col gap-2 rounded-card border border-border bg-background px-[18px] py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ready-title" className="m-0 flex items-center gap-2 text-[15px] font-semibold">
          <Send className="size-4 text-pill-finalized-foreground" aria-hidden="true" />
          Ready to send
        </h2>
        <span className="text-xs text-muted-foreground">
          {count === 1
            ? "1 document has a number but did not go out. It is not billed yet."
            : `${count} documents have numbers but did not go out. They are not billed yet.`}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to={documentPath(item.kind)}
              params={{ documentId: item.id }}
              search={{ send: true }}
              className="font-medium text-ink hover:underline"
            >
              {item.number ?? "Draft"} · {item.clientName}
            </Link>
            <span className="figure">{formatMoney(item.total, item.currency)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const RECENT_EMPTY: Record<ListFilter, string> = {
  all: "No invoices yet.",
  unpaid: "No unpaid invoices.",
  overdue: "No overdue invoices.",
  drafts: "No draft invoices.",
};

function RecentInvoices({
  data,
  filter,
  onFilter,
}: {
  data: DashboardData;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
}) {
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="recent-title" className="m-0 text-[15px] font-semibold">
          Recent invoices
        </h2>
        <SegmentedControl
          aria-label="Filter recent invoices"
          selectedKey={filter}
          onSelectionChange={(key) => onFilter(String(key) as ListFilter)}
        >
          {LIST_FILTER_OPTIONS.invoice.map((option) => (
            <Segment key={option.id} id={option.id}>
              {option.label}
            </Segment>
          ))}
        </SegmentedControl>
      </div>
      {data.recent.length === 0 ? (
        <p className="m-0 rounded-card border border-border px-5 py-6 text-center text-[13px] text-muted-foreground">
          {RECENT_EMPTY[filter]}
        </p>
      ) : (
        <DocumentTable items={data.recent} label="Recent invoices" />
      )}
      <Link
        to="/invoices"
        search={{ filter: filter === "all" ? undefined : filter }}
        className="self-end text-[13px] font-medium text-tint-foreground hover:underline"
      >
        All invoices
      </Link>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-7" aria-busy="true">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[106px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-[104px] rounded-card" />
      <Skeleton className="h-72 rounded-card" />
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ListFilter>("all");
  const dashboard = useDashboard(filter);
  const data = dashboard.data;
  const today = data?.today ?? new Date().toISOString().slice(0, 10);

  const actions = (
    <>
      <Button variant="secondary" onPress={() => navigate({ to: "/quotes/new" })}>
        New quote
      </Button>
      <Button onPress={() => navigate({ to: "/invoices/new" })}>
        <Plus className="size-4" aria-hidden="true" />
        New invoice
      </Button>
    </>
  );

  return (
    <>
      <PageHeader eyebrow={longDate(today)} title="Overview" actions={actions} />
      {!data ? (
        <LoadingState />
      ) : data.isEmpty ? (
        <>
          <EmptyState
            icon={FileText}
            title="Send your first invoice"
            description="Totals, overdue invoices, and payments appear here once you send an invoice."
            action={
              <>
                <Button variant="secondary" onPress={() => navigate({ to: "/clients" })}>
                  Add a client
                </Button>
                <Button onPress={() => navigate({ to: "/invoices/new" })}>
                  <Plus className="size-4" aria-hidden="true" />
                  New invoice
                </Button>
              </>
            }
          />
          {data.failedJobs.count > 0 ? (
            <FailedJobsPanel items={data.failedJobs.items} count={data.failedJobs.count} />
          ) : null}
        </>
      ) : (
        <>
          <Kpis data={data} />
          <ReadyToSend data={data} />
          <CurrencyBar rows={data.byCurrency} homeCurrency={data.homeCurrency} />
          <RecentInvoices data={data} filter={filter} onFilter={setFilter} />
          <div className="grid gap-5 lg:grid-cols-2">
            <NeedsReminderList items={data.needsReminder} />
            <NotificationsPanel
              items={data.notifications.items}
              unreadCount={data.notifications.unreadCount}
            />
          </div>
          {data.failedJobs.count > 0 ? (
            <FailedJobsPanel items={data.failedJobs.items} count={data.failedJobs.count} />
          ) : null}
        </>
      )}
    </>
  );
}
