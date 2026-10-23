import { useQuery } from "@tanstack/react-query";
import type { TaxRate } from "../../shared/schemas/tax-rate";
import type { TemplateSummary } from "../../shared/schemas/template";
import { api } from "./api";
import { queryKeys } from "./query-keys";

/** Tax rates for pickers and the settings page. */
export function useTaxRates({ includeArchived = false } = {}) {
  return useQuery({
    queryKey: queryKeys.taxRates.list(includeArchived),
    queryFn: () =>
      api<{ items: TaxRate[] }>("/tax-rates", {
        query: { archived: includeArchived ? "include" : undefined },
      }).then((r) => r.items),
  });
}

/** Active templates for pickers. */
export function useTemplates() {
  return useQuery({
    queryKey: queryKeys.templates.list,
    queryFn: () => api<{ items: TemplateSummary[] }>("/templates").then((r) => r.items),
  });
}
