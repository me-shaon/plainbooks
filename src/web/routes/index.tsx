import { createFileRoute } from "@tanstack/react-router";
import { House } from "lucide-react";
import { PageHeader } from "../components/page-header";
import { EmptyState } from "../components/ui/empty-state";

export const Route = createFileRoute("/")({
  component: Overview,
});

function Overview() {
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <>
      <PageHeader eyebrow={today} title="Overview" />
      <EmptyState
        icon={House}
        title="Overview is not built yet"
        description="Totals, recent invoices, and reminders come in a later release."
      />
    </>
  );
}
