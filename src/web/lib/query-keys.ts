import type { ClientArchiveFilter } from "../../shared/schemas/client";

/**
 * TanStack Query keys, one tree per resource. Invalidate a whole resource with its `all`
 * key, for example `queryClient.invalidateQueries({ queryKey: queryKeys.clients.all })`.
 */
export const queryKeys = {
  me: ["me"] as const,
  clients: {
    all: ["clients"] as const,
    list: (filters: { q?: string; archived: ClientArchiveFilter }) =>
      ["clients", "list", filters] as const,
    detail: (id: string) => ["clients", "detail", id] as const,
  },
  taxRates: {
    all: ["tax-rates"] as const,
    list: (includeArchived: boolean) => ["tax-rates", "list", { includeArchived }] as const,
  },
  templates: {
    all: ["templates"] as const,
    list: ["templates", "list"] as const,
    detail: (id: string) => ["templates", "detail", id] as const,
  },
  customFields: {
    all: ["custom-fields"] as const,
    list: (includeArchived: boolean) => ["custom-fields", "list", { includeArchived }] as const,
    values: (scope: "workspace" | "client", entityId: string) =>
      ["custom-fields", "values", scope, entityId] as const,
  },
  settings: {
    all: ["settings"] as const,
    workspace: ["settings", "workspace"] as const,
    brandKit: ["settings", "brand-kit"] as const,
  },
  team: {
    all: ["team"] as const,
  },
};
