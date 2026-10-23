import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage, validateDocumentsSearch } from "../../features/documents/documents-page";

export const Route = createFileRoute("/quotes/")({
  validateSearch: (search: Record<string, unknown>) => validateDocumentsSearch("quote", search),
  component: function DocumentsRoute() {
    return <DocumentsPage kind="quote" search={Route.useSearch()} />;
  },
});
