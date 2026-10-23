import type { ClientArchiveFilter } from "../../shared/schemas/client";
import type { DocumentListQuery } from "../../shared/schemas/document";

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
  documents: {
    all: ["documents"] as const,
    list: (filters: DocumentListQuery) => ["documents", "list", filters] as const,
    detail: (id: string) => ["documents", "detail", id] as const,
    activity: (id: string) => ["documents", "activity", id] as const,
    revisions: (id: string) => ["documents", "revisions", id] as const,
    sendPreview: (id: string, revise: boolean) =>
      ["documents", "send-preview", id, { revise }] as const,
  },
  /**
   * The overview aggregate. It sits under "documents", so every document mutation that
   * invalidates `documents.all` also refreshes the dashboard.
   */
  dashboard: {
    all: ["documents", "dashboard"] as const,
    view: (recent: string) => ["documents", "dashboard", { recent }] as const,
  },
  /** Reports. Under "documents" so document mutations refresh them too. */
  reports: {
    all: ["documents", "reports"] as const,
    view: (report: string, query: Record<string, string | undefined>) =>
      ["documents", "reports", report, query] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (state: string, page: number) => ["notifications", "list", { state, page }] as const,
  },
  recurring: {
    all: ["recurring"] as const,
    list: ["recurring", "list"] as const,
    detail: (id: string) => ["recurring", "detail", id] as const,
  },
  reminders: {
    all: ["reminders"] as const,
    suggestions: ["reminders", "suggestions"] as const,
    status: (documentId: string) => ["reminders", "status", documentId] as const,
  },
  fx: {
    rate: (currency: string, date: string) => ["fx", "rate", currency, date] as const,
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
