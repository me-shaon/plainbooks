import { createFileRoute } from "@tanstack/react-router";
import { EditDocumentPage } from "../../../features/documents/editor-page";

export const Route = createFileRoute("/quotes/$documentId/edit")({
  component: function EditDocumentRoute() {
    const { documentId } = Route.useParams();
    return <EditDocumentPage key={documentId} documentId={documentId} />;
  },
});
