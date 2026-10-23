import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage, validateDocumentsSearch } from "../../features/documents/documents-page";

export const Route = createFileRoute("/invoices/")({
  validateSearch: (search: Record<string, unknown>) => validateDocumentsSearch("invoice", search),
  component: function DocumentsRoute() {
    return <DocumentsPage kind="invoice" search={Route.useSearch()} />;
  },
});
