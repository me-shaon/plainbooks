import { createFileRoute } from "@tanstack/react-router";
import { TaxRatesPage } from "../../features/settings/tax-rates-page";

export const Route = createFileRoute("/settings/tax-rates")({
  component: TaxRatesPage,
});
