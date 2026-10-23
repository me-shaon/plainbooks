import { createFileRoute } from "@tanstack/react-router";
import { TemplateEditorPage } from "../../features/templates/template-editor";

export const Route = createFileRoute("/templates/$templateId")({
  component: function TemplateRoute() {
    const { templateId } = Route.useParams();
    return <TemplateEditorPage key={templateId} templateId={templateId} />;
  },
});
