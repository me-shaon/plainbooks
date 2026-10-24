import { Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ArrowLeft, FileText, Pencil, Wallet } from "lucide-react";
import { useState } from "react";
import {
  type ClientDetail,
  REMINDER_MODE_LABELS,
  SEND_MODE_LABELS,
} from "../../../shared/schemas/client";
import { taxRateLabel } from "../../../shared/schemas/tax-rate";
import { KpiCard, KpiGrid } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { AlertDialog } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { Pill } from "../../components/ui/pill";
import { DetailItem, Section } from "../../components/ui/section";
import { Skeleton } from "../../components/ui/skeleton";
import { StackedList, StackedRow } from "../../components/ui/stacked-list";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../../components/ui/table";
import { toast } from "../../components/ui/toast";
import { formatDate, formatMoney } from "../../lib/format";
import { useTaxRates, useTemplates } from "../../lib/reference-data";
import { documentPath } from "../documents/labels";
import { ClientCustomFields } from "../templates/client-custom-fields";
import { ClientFormDialog } from "./client-form";
import { useArchiveClient, useClient } from "./queries";

type DocumentRow = ClientDetail["documents"][number];

function documentLabel(doc: DocumentRow): string {
  const kind = doc.kind === "invoice" ? "Invoice" : "Quote";
  return doc.number ? `${kind} ${doc.number}` : `${kind} draft`;
}

export function ClientDetailPage({ clientId }: { clientId: string }) {
  const query = useClient(clientId);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useArchiveClient();

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="This client could not be loaded"
        description={query.error.message}
        action={
          <Link to="/clients" className="text-sm font-medium text-accent underline">
            Back to clients
          </Link>
        }
      />
    );
  }

  const detail = query.data;
  const { client } = detail;
  const isArchived = client.archivedAt !== null;

  const setArchived = (value: boolean) =>
    archive.mutate(
      { id: client.id, archive: value },
      {
        onSuccess: () =>
          toast({
            title: value ? "Client archived" : "Client restored",
            description: value ? "Its recurring schedules are paused." : undefined,
            tone: "success",
          }),
      },
    );

  return (
    <>
      <Link
        to="/clients"
        className="-mb-4 inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Clients
      </Link>
      <PageHeader
        title={client.name}
        subtitle={isArchived ? "Archived. This client is hidden from pickers." : undefined}
        actions={
          <>
            <Button variant="secondary" onPress={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
            {isArchived ? (
              <Button
                variant="secondary"
                isPending={archive.isPending}
                onPress={() => setArchived(false)}
              >
                <ArchiveRestore className="size-4" aria-hidden="true" />
                Restore
              </Button>
            ) : (
              <Button variant="secondary" onPress={() => setConfirmArchive(true)}>
                <Archive className="size-4" aria-hidden="true" />
                Archive
              </Button>
            )}
          </>
        }
      />

      <OutstandingCards detail={detail} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <DocumentsSection detail={detail} />
          <PaymentsSection detail={detail} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <ContactsSection detail={detail} />
          <DefaultsSection detail={detail} />
          <ClientCustomFields clientId={detail.client.id} />
        </div>
      </div>

      <ClientFormDialog
        // Remount on each open so the form starts from the saved values.
        key={editing ? "open" : "closed"}
        isOpen={editing}
        onOpenChange={setEditing}
        client={detail}
      />
      <AlertDialog
        isOpen={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${client.name}?`}
        actionLabel="Archive client"
        variant="danger"
        onAction={() => setArchived(true)}
      >
        The client disappears from pickers. Its documents stay. Its active recurring schedules are
        paused, and restoring the client does not resume them.
      </AlertDialog>
    </>
  );
}

function OutstandingCards({ detail }: { detail: ClientDetail }) {
  if (detail.outstanding.length === 0) {
    return (
      <KpiGrid>
        <KpiCard
          variant="hero"
          label="Outstanding"
          value={formatMoney(0, detail.client.defaultCurrency)}
          note="No open invoices"
        />
      </KpiGrid>
    );
  }
  return (
    <KpiGrid>
      {detail.outstanding.map((row, index) => (
        <KpiCard
          key={row.currency}
          variant={index === 0 ? "hero" : "default"}
          label={`Outstanding in ${row.currency}`}
          value={formatMoney(row.amount, row.currency)}
          note={`${row.count} open ${row.count === 1 ? "invoice" : "invoices"}`}
        />
      ))}
    </KpiGrid>
  );
}

function DocumentsSection({ detail }: { detail: ClientDetail }) {
  const navigate = useNavigate();
  const docs = detail.documents;
  return (
    <Section title="Quotes and invoices" flush>
      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          className="rounded-none rounded-b-card"
          title="No quotes or invoices yet"
          description="Documents for this client show here."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table
              aria-label="Quotes and invoices"
              className="min-w-0"
              onRowAction={(key) => {
                const doc = docs.find((d) => d.id === key);
                if (doc)
                  void navigate({ to: documentPath(doc.kind), params: { documentId: doc.id } });
              }}
            >
              <TableHeader>
                <Column isRowHeader>Document</Column>
                <Column>Status</Column>
                <Column>Issued</Column>
                <Column align="end">Total</Column>
                <Column align="end">Balance</Column>
              </TableHeader>
              <TableBody items={docs}>
                {(doc) => (
                  <Row id={doc.id} className="cursor-pointer">
                    <Cell>{documentLabel(doc)}</Cell>
                    <Cell>
                      <Pill status={doc.displayStatus} />
                    </Cell>
                    <Cell>{formatDate(doc.issueDate) || "Not sent"}</Cell>
                    <Cell align="end">
                      <span className="figure">{formatMoney(doc.total, doc.currency)}</span>
                    </Cell>
                    <Cell align="end">
                      <span className="figure">
                        {doc.kind === "invoice"
                          ? formatMoney(doc.total - doc.amountPaid, doc.currency)
                          : ""}
                      </span>
                    </Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </div>
          <StackedList label="Quotes and invoices" className="rounded-none border-0 md:hidden">
            {docs.map((doc) => (
              <StackedRow
                key={doc.id}
                to={documentPath(doc.kind)}
                params={{ documentId: doc.id }}
                title={documentLabel(doc)}
                meta={<Pill status={doc.displayStatus} />}
                value={<span className="figure">{formatMoney(doc.total, doc.currency)}</span>}
              />
            ))}
          </StackedList>
        </>
      )}
    </Section>
  );
}

function PaymentsSection({ detail }: { detail: ClientDetail }) {
  const rows = detail.payments;
  return (
    <Section title="Payments" flush>
      {rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          className="rounded-none rounded-b-card"
          title="No payments yet"
          description="Payments recorded on this client's invoices show here."
        />
      ) : (
        <StackedList label="Payments" className="rounded-none border-0">
          {rows.map((payment) => (
            <StackedRow
              key={payment.id}
              title={payment.documentNumber ?? "Invoice"}
              meta={`${formatDate(payment.paidOn)}${payment.kind === "write_off" ? " · Written off" : ""}`}
              value={
                <span className="figure">{formatMoney(payment.amount, payment.currency)}</span>
              }
            />
          ))}
        </StackedList>
      )}
    </Section>
  );
}

function ContactsSection({ detail }: { detail: ClientDetail }) {
  return (
    <Section title="Contacts">
      {detail.contacts.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          No contacts. Edit the client to add one.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {detail.contacts.map((contact) => (
            <li key={contact.id} className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{contact.name ?? contact.email}</span>
              {contact.name ? (
                <span className="truncate text-[13px] text-muted-foreground">{contact.email}</span>
              ) : null}
              {contact.isPrimary || contact.isBilling ? (
                <span className="text-xs text-muted-foreground">
                  {[contact.isPrimary && "Primary", contact.isBilling && "Gets invoices"]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DefaultsSection({ detail }: { detail: ClientDetail }) {
  const { client } = detail;
  const taxRates = useTaxRates({ includeArchived: true });
  const templates = useTemplates();
  const rate = taxRates.data?.find((r) => r.id === client.defaultTaxRateId);
  const template = templates.data?.find((t) => t.id === client.templateId);
  return (
    <Section title="Details and defaults">
      <dl className="m-0 grid gap-4">
        <DetailItem label="Currency">{client.defaultCurrency}</DetailItem>
        <DetailItem label="Tax rate">{rate ? taxRateLabel(rate) : "No tax"}</DetailItem>
        <DetailItem label="Payment terms">
          {client.paymentTermsDays === null
            ? "Workspace default"
            : `${client.paymentTermsDays} days`}
        </DetailItem>
        <DetailItem label="Template">{template?.name ?? "Workspace default"}</DetailItem>
        <DetailItem label="Reminders">{REMINDER_MODE_LABELS[client.reminderMode]}</DetailItem>
        <DetailItem label="Recurring invoices">
          {SEND_MODE_LABELS[client.recurringSendMode]}
        </DetailItem>
        {client.billingAddress ? (
          <DetailItem label="Billing address">{client.billingAddress}</DetailItem>
        ) : null}
        {client.taxId ? <DetailItem label="Tax ID">{client.taxId}</DetailItem> : null}
        {client.notes ? <DetailItem label="Notes">{client.notes}</DetailItem> : null}
      </dl>
    </Section>
  );
}
