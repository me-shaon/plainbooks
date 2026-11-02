import { createFileRoute } from "@tanstack/react-router";
import { ExchangeRatesPage } from "../../features/settings/exchange-rates-page";

export const Route = createFileRoute("/settings/exchange-rates")({
  component: ExchangeRatesPage,
});
