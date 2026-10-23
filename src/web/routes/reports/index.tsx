import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage, validateReportsSearch } from "../../features/reports/reports-page";

export const Route = createFileRoute("/reports/")({
  validateSearch: validateReportsSearch,
  component: function ReportsRoute() {
    return <ReportsPage search={Route.useSearch()} />;
  },
});
