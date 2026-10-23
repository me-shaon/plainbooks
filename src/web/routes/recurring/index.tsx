import { createFileRoute } from "@tanstack/react-router";
import { RotateCw } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/recurring/")({
  component: () => (
    <PlaceholderPage
      title="Recurring"
      subtitle="Schedules that create invoices on their own."
      icon={RotateCw}
    />
  ),
});
