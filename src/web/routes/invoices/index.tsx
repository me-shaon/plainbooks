import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/invoices/")({
  component: () => (
    <PlaceholderPage
      title="Invoices"
      subtitle="Every invoice, its status, and its balance."
      icon={FileText}
    />
  ),
});
