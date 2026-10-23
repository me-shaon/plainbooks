import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/quotes/")({
  component: () => (
    <PlaceholderPage
      title="Quotes"
      subtitle="Estimates you send before the work starts."
      icon={MessageSquare}
    />
  ),
});
