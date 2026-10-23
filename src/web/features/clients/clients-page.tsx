import { useNavigate } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClientArchiveFilter, ClientSummary } from "../../../shared/schemas/client";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { SearchField } from "../../components/ui/search-field";
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
import { formatMoney } from "../../lib/format";
import { ClientFormDialog } from "./client-form";
import { useClients } from "./queries";

export interface ClientsSearch {
  q?: string;
  archived?: ClientArchiveFilter;
}

function Outstanding({ client }: { client: ClientSummary }) {
  if (client.outstanding.length === 0) {
    return <span className="text-muted-foreground">Nothing due</span>;
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      {client.outstanding.map((row) => (
        <span key={row.currency} className="figure">
          {formatMoney(row.amount, row.currency)}
        </span>
      ))}
    </span>
  );
}

/** Waits until typing pauses before the value changes. */
function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ClientsPage({ search }: { search: ClientsSearch }) {
  const navigate = useNavigate({ from: "/clients/" });
  const archived = search.archived ?? "active";
  const [text, setText] = useState(search.q ?? "");
  const q = useDebounced(text.trim());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true });
  }, [q, navigate]);

  const clients = useClients({ q: q || undefined, archived });
  const items = clients.data ?? [];
  const filtered = Boolean(q) || archived !== "active";

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="The people and companies you bill."
        actions={
          <Button onPress={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New client
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchField
          aria-label="Search clients"
          placeholder="Search by name or email"
          value={text}
          onChange={setText}
          className="w-full sm:max-w-xs"
        />
        <SegmentedControl
          aria-label="Show"
          selectedKey={archived}
          onSelectionChange={(key) =>
            navigate({
              search: (prev) => ({
                ...prev,
                archived: key === "active" ? undefined : (key as ClientArchiveFilter),
              }),
            })
          }
        >
          <Segment id="active">Active</Segment>
          <Segment id="archived">Archived</Segment>
          <Segment id="all">All</Segment>
        </SegmentedControl>
      </div>

      {clients.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? "No clients match" : "No clients yet"}
          description={
            filtered
              ? "Try another search, or change the filter."
              : "Add your first client to start sending quotes and invoices."
          }
          action={
            filtered ? null : (
              <Button onPress={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden="true" />
                New client
              </Button>
            )
          }
        />
      ) : (
        <>
          <TableContainer className="hidden md:block">
            <Table
              aria-label="Clients"
              className="min-w-0"
              onRowAction={(key) =>
                navigate({ to: "/clients/$clientId", params: { clientId: String(key) } })
              }
            >
              <TableHeader>
                <Column isRowHeader>Name</Column>
                <Column>Primary contact</Column>
                <Column>Currency</Column>
                <Column align="end">Outstanding</Column>
              </TableHeader>
              <TableBody items={items}>
                {(client) => (
                  <Row id={client.id} className="cursor-pointer">
                    <Cell>
                      <span className="font-medium">{client.name}</span>
                      {client.archivedAt ? (
                        <span className="ml-2 rounded-pill bg-segmented px-2 py-0.5 text-xs text-muted-foreground">
                          Archived
                        </span>
                      ) : null}
                    </Cell>
                    <Cell>
                      <span className="text-muted-foreground">{client.primaryEmail ?? "None"}</span>
                    </Cell>
                    <Cell>
                      <span className="figure">{client.defaultCurrency}</span>
                    </Cell>
                    <Cell align="end">
                      <Outstanding client={client} />
                    </Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <StackedList label="Clients" className="md:hidden">
            {items.map((client) => (
              <StackedRow
                key={client.id}
                to="/clients/$clientId"
                params={{ clientId: client.id }}
                title={client.name}
                meta={
                  client.archivedAt
                    ? `Archived · ${client.primaryEmail ?? "No contact"}`
                    : (client.primaryEmail ?? "No contact")
                }
                value={<Outstanding client={client} />}
              />
            ))}
          </StackedList>
        </>
      )}

      <ClientFormDialog
        isOpen={creating}
        onOpenChange={setCreating}
        onSaved={(detail) =>
          navigate({ to: "/clients/$clientId", params: { clientId: detail.client.id } })
        }
      />
    </>
  );
}
