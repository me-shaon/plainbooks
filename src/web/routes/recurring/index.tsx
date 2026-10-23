import { createFileRoute } from "@tanstack/react-router";
import { RecurringPage } from "../../features/recurring/recurring-page";

export const Route = createFileRoute("/recurring/")({
  component: RecurringPage,
});
