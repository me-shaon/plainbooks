import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/settings/")({
  component: () => (
    <PlaceholderPage
      title="Settings"
      subtitle="Workspace defaults, numbering, and members."
      icon={Settings}
    />
  ),
});
