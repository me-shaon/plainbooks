import { createFileRoute } from "@tanstack/react-router";
import { DocumentDetailPage } from "../../../features/documents/document-detail-page";

export const Route = createFileRoute("/quotes/$documentId/")({
  validateSearch: (search: Record<string, unknown>): { send?: boolean } => ({
    send: search.send === true || search.send === "true" ? true : undefined,
  }),
  component: function DocumentRoute() {
    const { documentId } = Route.useParams();
    const { send } = Route.useSearch();
    return <DocumentDetailPage key={documentId} documentId={documentId} openSend={send} />;
  },
});
