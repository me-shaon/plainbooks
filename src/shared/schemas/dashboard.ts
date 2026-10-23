import { z } from "zod";
import type { DocumentKind } from "../domain";
import type { DocumentSummary } from "./document";
import { LIST_FILTERS } from "./document";
import type { RecurringSummary } from "./recurring";
import type { ReminderSuggestion } from "./reminder";

/** GET /api/dashboard query. `recent` is the filter of the recent invoices table. */
export const dashboardQuery = z.object({
  recent: z.enum(LIST_FILTERS).default("all"),
});
export type DashboardQuery = z.input<typeof dashboardQuery>;

/** Open balance of one currency, exact in that currency and converted at stored rates. */
export interface CurrencyOutstanding {
  currency: string;
  /** Minor units of `currency`. */
  amount: number;
  /** Minor units of the home currency, at each invoice's stored rate. */
  home: number;
  invoiceCount: number;
}

export interface ReadyToSendItem {
  id: string;
  kind: DocumentKind;
  number: string | null;
  clientName: string;
  currency: string;
  total: number;
}

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  documentId: string | null;
  documentKind: DocumentKind | null;
  createdAt: number;
  /** Set when a user dismissed it. */
  readAt: number | null;
}

export interface FailedJobView {
  id: string;
  type: string;
  lastError: string | null;
  attempts: number;
  finishedAt: number | null;
  documentId: string | null;
}

/** GET /api/dashboard. Every amount is in minor units. */
export interface DashboardData {
  homeCurrency: string;
  /** Today in the workspace timezone. */
  today: string;
  /** True when the workspace has no documents yet. */
  isEmpty: boolean;
  outstanding: { home: number; invoiceCount: number; currencyCount: number };
  overdue: { home: number; invoiceCount: number; topClientName: string | null };
  paidThisMonth: { home: number; paymentCount: number; invoiceCount: number };
  nextRecurring: RecurringSummary | null;
  /** Sorted by the home value, largest first. */
  byCurrency: CurrencyOutstanding[];
  /** Numbered documents whose send failed. They are not billed yet. */
  readyToSend: { count: number; items: ReadyToSendItem[] };
  recent: DocumentSummary[];
  needsReminder: ReminderSuggestion[];
  notifications: { unreadCount: number; items: NotificationView[] };
  failedJobs: { count: number; items: FailedJobView[] };
}

/** GET /api/notifications query. */
export const notificationListQuery = z.object({
  state: z.enum(["unread", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface NotificationList {
  items: NotificationView[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}

/** A job type as a short phrase, for the failed jobs list. */
export function jobTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    send_document: "Send a document",
    send_email: "Send an email",
    send_reminder: "Send a reminder",
    recurring_issue: "Create a recurring invoice",
    notify_quote_decision: "Notify about a quote decision",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}
