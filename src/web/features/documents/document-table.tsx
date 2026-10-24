import { useNavigate } from "@tanstack/react-router";
import { formatGrouped } from "../../../shared/money";
import type { DocumentSummary } from "../../../shared/schemas/document";
import { Pill } from "../../components/ui/pill";
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
import { formatDate } from "../../lib/format";
import { documentPath } from "./labels";

/** The amount as "USD 1,250.00" with a muted code, like the Ledger table. */
export function Amount({ minor, currency }: { minor: number; currency: string }) {
  return (
    <span className="figure font-medium whitespace-nowrap">
      <span className="font-normal text-muted-foreground">{currency}</span>{" "}
      {formatGrouped(minor, currency)}
    </span>
  );
}

function dateColumn(doc: DocumentSummary): string {
  const date = doc.kind === "invoice" ? doc.dueDate : doc.expiryDate;
  return date ? formatDate(date) : "On send";
}

export interface DocumentTableProps {
  items: DocumentSummary[];
  label: string;
  /** Hides the client column, for example on a client page. */
  hideClient?: boolean;
}

/**
 * The Ledger document table above 768 px and stacked rows below it. Rows open the detail
 * page. The dashboard and the client page can reuse it.
 */
export function DocumentTable({ items, label, hideClient }: DocumentTableProps) {
  const navigate = useNavigate();
  const dateLabel = items.every((d) => d.kind === "quote")
    ? "Expires"
    : items.every((d) => d.kind === "invoice")
      ? "Due"
      : "Due or expires";
  return (
    <>
      <TableContainer className="hidden md:block">
        <Table
          aria-label={label}
          onRowAction={(key) => {
            const doc = items.find((d) => d.id === key);
            if (doc) void navigate({ to: documentPath(doc.kind), params: { documentId: doc.id } });
          }}
        >
          <TableHeader>
            <Column isRowHeader>Number</Column>
            {hideClient ? <Column>Description</Column> : <Column>Client</Column>}
            <Column>Status</Column>
            <Column>{dateLabel}</Column>
            <Column align="end">Amount</Column>
          </TableHeader>
          <TableBody items={items}>
            {(doc) => (
              <Row id={doc.id} className="cursor-pointer">
                <Cell>
                  <span className="figure text-[12.5px] text-muted-foreground">
                    {doc.number ?? "Draft"}
                  </span>
                </Cell>
                <Cell>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {hideClient ? null : <span className="font-medium">{doc.clientName}</span>}
                    {doc.summary ? (
                      <span className="max-w-[320px] truncate text-xs text-muted-foreground">
                        {doc.summary}
                      </span>
                    ) : null}
                  </div>
                </Cell>
                <Cell>
                  <Pill status={doc.displayStatus} />
                </Cell>
                <Cell>
                  <span className="text-muted-foreground">{dateColumn(doc)}</span>
                </Cell>
                <Cell align="end">
                  <Amount minor={doc.total} currency={doc.currency} />
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <StackedList label={label} className="md:hidden">
        {items.map((doc) => (
          <StackedRow
            key={doc.id}
            to={documentPath(doc.kind)}
            params={{ documentId: doc.id }}
            title={hideClient ? (doc.summary ?? doc.number ?? "Draft") : doc.clientName}
            meta={
              <span className="flex items-center gap-2">
                <span className="figure">{doc.number ?? "Draft"}</span>
                <Pill status={doc.displayStatus} />
              </span>
            }
            value={<Amount minor={doc.total} currency={doc.currency} />}
          />
        ))}
      </StackedList>
    </>
  );
}
