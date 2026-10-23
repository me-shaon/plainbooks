import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/templates/")({
  component: () => (
    <PlaceholderPage
      title="Templates"
      subtitle="Layouts for invoices and quotes."
      icon={LayoutDashboard}
    />
  ),
});
