import { useNavigate } from "@tanstack/react-router";
import { FileText, MessageSquare, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { DocumentKind } from "../../../shared/domain";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { ComboBox } from "../../components/ui/combo-box";
import { EmptyState } from "../../components/ui/empty-state";
import { ListBoxItem } from "../../components/ui/list-box";
import { SearchField } from "../../components/ui/search-field";
import { Segment, SegmentedControl } from "../../components/ui/segmented-control";
import { Skeleton } from "../../components/ui/skeleton";
import { useClients } from "../clients/queries";
import { DocumentTable } from "./document-table";
import { LIST_FILTER_OPTIONS } from "./labels";
import { useDocuments } from "./queries";

export const PAGE_SIZE = 25;

export interface DocumentsSearch {
  filter?: string;
  q?: string;
  clientId?: string;
  page?: number;
}

/** Validates the list search params for either kind. */
export function validateDocumentsSearch(
  kind: DocumentKind,
  search: Record<string, unknown>,
): DocumentsSearch {
  const page = Number(search.page);
  return {
    filter: LIST_FILTER_OPTIONS[kind].find((f) => f.id === search.filter && f.id !== "all")?.id,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    clientId: typeof search.clientId === "string" && search.clientId ? search.clientId : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const COPY = {
  invoice: {
    title: "Invoices",
    subtitle: "Every invoice, its status, and its balance.",
    newLabel: "New invoice",
    empty: "No invoices yet",
    emptyText: "Create an invoice, then send it by email or share the link.",
    icon: FileText,
    from: "/invoices/" as const,
    newPath: "/invoices/new" as const,
  },
  quote: {
    title: "Quotes",
    subtitle: "Estimates your clients can accept online.",
    newLabel: "New quote",
    empty: "No quotes yet",
    emptyText: "Create a quote. When the client accepts it, convert it to an invoice.",
    icon: MessageSquare,
    from: "/quotes/" as const,
    newPath: "/quotes/new" as const,
  },
};

export function DocumentsPage({ kind, search }: { kind: DocumentKind; search: DocumentsSearch }) {
  const copy = COPY[kind];
  const navigate = useNavigate({ from: copy.from });
  const [text, setText] = useState(search.q ?? "");
  const q = useDebounced(text.trim());
  const options = LIST_FILTER_OPTIONS[kind];
  const filterId = search.filter ?? "all";
  const filter = options.find((f) => f.id === filterId) ?? options[0];
  const page = search.page ?? 1;
  const clients = useClients({ archived: "all" });

  useEffect(() => {
    void navigate({
      search: (prev) =>
        prev.q === (q || undefined) ? prev : { ...prev, q: q || undefined, page: undefined },
      replace: true,
    });
  }, [q, navigate]);

  const documents = useDocuments({
    kind,
    ...filter?.query,
    q: q || undefined,
    clientId: search.clientId,
    page,
    pageSize: PAGE_SIZE,
  });
  const data = documents.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q) || filterId !== "all" || Boolean(search.clientId);
  const NewButton = (
    <Button onPress={() => navigate({ to: copy.newPath })}>
      <Plus className="size-4" aria-hidden="true" />
      {copy.newLabel}
    </Button>
  );

  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} actions={NewButton} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          aria-label="Filter"
          selectedKey={filterId}
          onSelectionChange={(key) =>
            navigate({
              search: (prev) => ({
                ...prev,
                filter: key === "all" ? undefined : String(key),
                page: undefined,
              }),
            })
          }
        >
          {options.map((option) => (
            <Segment key={option.id} id={option.id}>
              {option.label}
            </Segment>
          ))}
        </SegmentedControl>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField
            aria-label={`Search ${copy.title.toLowerCase()}`}
            placeholder="Search client or number"
            value={text}
            onChange={setText}
            className="w-full sm:w-64"
          />
          <ComboBox
            aria-label="Client"
            placeholder="All clients"
            className="w-full sm:w-56"
            defaultItems={clients.data ?? []}
            value={search.clientId ?? null}
            onChange={(key) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  clientId: key === null ? undefined : String(key),
                  page: undefined,
                }),
              })
            }
          >
            {(client: { id: string; name: string }) => (
              <ListBoxItem id={client.id}>{client.name}</ListBoxItem>
            )}
          </ComboBox>
        </div>
      </div>

      {documents.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={copy.icon}
          title={filtered ? `No ${copy.title.toLowerCase()} match` : copy.empty}
          description={filtered ? "Try another search, or change the filter." : copy.emptyText}
          action={filtered ? null : NewButton}
        />
      ) : (
        <>
          <DocumentTable items={items} label={copy.title} />
          {pages > 1 ? (
            <nav
              aria-label="Pages"
              className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground"
            >
              <span>
                Page {page} of {pages} · {total} {copy.title.toLowerCase()}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={page <= 1}
                  onPress={() =>
                    navigate({
                      search: (prev) => ({ ...prev, page: page - 1 > 1 ? page - 1 : undefined }),
                    })
                  }
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={page >= pages}
                  onPress={() => navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })}
                >
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
