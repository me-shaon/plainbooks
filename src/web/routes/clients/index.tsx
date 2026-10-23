import { createFileRoute } from "@tanstack/react-router";
import { CLIENT_ARCHIVE_FILTERS } from "../../../shared/schemas/client";
import { ClientsPage, type ClientsSearch } from "../../features/clients/clients-page";

export const Route = createFileRoute("/clients/")({
  validateSearch: (search: Record<string, unknown>): ClientsSearch => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    archived: CLIENT_ARCHIVE_FILTERS.find((f) => f === search.archived && f !== "active"),
  }),
  component: function ClientsRoute() {
    return <ClientsPage search={Route.useSearch()} />;
  },
});
