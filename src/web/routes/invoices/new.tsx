import { createFileRoute } from "@tanstack/react-router";
import { NewDocumentPage } from "../../features/documents/editor-page";

export const Route = createFileRoute("/invoices/new")({
  validateSearch: (search: Record<string, unknown>): { clientId?: string } => ({
    clientId: typeof search.clientId === "string" && search.clientId ? search.clientId : undefined,
  }),
  component: function NewDocumentRoute() {
    const { clientId } = Route.useSearch();
    return <NewDocumentPage kind="invoice" clientId={clientId} />;
  },
});
