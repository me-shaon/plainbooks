import { Link, useNavigate } from "@tanstack/react-router";
import { RotateCw } from "lucide-react";
import { FREQUENCY_LABELS, type RecurringSummary } from "../../../shared/schemas/recurring";
import { PageHeader } from "../../components/page-header";
import { EmptyState } from "../../components/ui/empty-state";
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
import { formatDate, formatMoney } from "../../lib/format";
import { useSchedules } from "./queries";
import { ScheduleStatusPill } from "./schedule-status";

/** "Next 23 Nov 2026", or the paused or ended state. */
export function nextIssueText(s: Pick<RecurringSummary, "status" | "nextIssueDate">): string {
  if (s.status === "ended") return "Ended";
  if (s.status === "paused") return "Paused";
  return formatDate(s.nextIssueDate);
}

function sendModeText(s: RecurringSummary): string {
  const mode = s.resolvedSendMode === "auto_send" ? "Auto-send" : "Draft for review";
  return s.sendMode === "inherit" ? `${mode} (default)` : mode;
}

export function RecurringPage() {
  const navigate = useNavigate();
  const schedules = useSchedules();
  const items = schedules.data ?? [];

  return (
    <>
      <PageHeader title="Recurring" subtitle="Schedules that create invoices on their own." />
      {schedules.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={RotateCw}
          title="No recurring schedules yet"
          description="Open an invoice and choose Make recurring in its menu. The schedule copies the client, the lines, and the terms."
          action={
            <Link to="/invoices" className="text-sm font-medium text-accent underline">
              Go to invoices
            </Link>
          }
        />
      ) : (
        <>
          <TableContainer className="hidden md:block">
            <Table
              aria-label="Recurring schedules"
              onRowAction={(key) =>
                navigate({ to: "/recurring/$scheduleId", params: { scheduleId: String(key) } })
              }
            >
              <TableHeader>
                <Column isRowHeader>Client</Column>
                <Column>Frequency</Column>
                <Column>Next issue</Column>
                <Column>Send mode</Column>
                <Column>Status</Column>
                <Column align="end">Amount</Column>
              </TableHeader>
              <TableBody items={items}>
                {(s) => (
                  <Row id={s.id} className="cursor-pointer">
                    <Cell>
                      <span className="flex flex-col">
                        <span className="font-medium">{s.clientName}</span>
                        {s.name ? (
                          <span className="text-xs text-muted-foreground">{s.name}</span>
                        ) : null}
                      </span>
                    </Cell>
                    <Cell>{FREQUENCY_LABELS[s.frequency]}</Cell>
                    <Cell>{nextIssueText(s)}</Cell>
                    <Cell>
                      <span className="text-muted-foreground">{sendModeText(s)}</span>
                    </Cell>
                    <Cell>
                      <ScheduleStatusPill status={s.status} />
                    </Cell>
                    <Cell align="end">
                      <span className="figure">{formatMoney(s.total, s.currency)}</span>
                    </Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <StackedList label="Recurring schedules" className="md:hidden">
            {items.map((s) => (
              <StackedRow
                key={s.id}
                to="/recurring/$scheduleId"
                params={{ scheduleId: s.id }}
                title={s.name ? `${s.clientName} · ${s.name}` : s.clientName}
                meta={`${FREQUENCY_LABELS[s.frequency]} · ${s.status === "active" ? `Next ${nextIssueText(s)}` : nextIssueText(s)}`}
                value={<span className="figure">{formatMoney(s.total, s.currency)}</span>}
              />
            ))}
          </StackedList>
        </>
      )}
    </>
  );
}
