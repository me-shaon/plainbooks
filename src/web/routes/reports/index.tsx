import { createFileRoute } from "@tanstack/react-router";
import { ChartColumn } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/reports/")({
  component: () => (
    <PlaceholderPage
      title="Reports"
      subtitle="Income, outstanding totals, and tax."
      icon={ChartColumn}
    />
  ),
});
