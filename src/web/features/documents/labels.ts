import type { DocumentKind, FxProvider } from "../../../shared/domain";
import type { ActivityEntry, DocumentListQuery } from "../../../shared/schemas/document";
import { reminderOffsetText } from "../../../shared/schemas/reminder";
import { formatDate, formatMoney } from "../../lib/format";

export const FX_PROVIDER_LABELS: Record<FxProvider, string> = {
  frankfurter: "Frankfurter (ECB)",
  manual: "Manual",
  identity: "Same currency",
};

/** One segment of the list filter and the API query it maps to. */
export interface ListFilterOption {
  id: string;
  label: string;
  query: Pick<DocumentListQuery, "filter" | "status">;
}

export const LIST_FILTER_OPTIONS: Record<DocumentKind, ListFilterOption[]> = {
  invoice: [
    { id: "all", label: "All", query: { filter: "all" } },
    { id: "unpaid", label: "Unpaid", query: { filter: "unpaid" } },
    { id: "overdue", label: "Overdue", query: { filter: "overdue" } },
    { id: "drafts", label: "Drafts", query: { filter: "drafts" } },
  ],
  quote: [
    { id: "all", label: "All", query: { filter: "all" } },
    { id: "open", label: "Open", query: { status: "sent" } },
    { id: "accepted", label: "Accepted", query: { status: "accepted" } },
    { id: "drafts", label: "Drafts", query: { filter: "drafts" } },
  ],
};

const ACTIVITY_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  finalized: "Number assigned",
  sent: "Sent",
  revised: "Revised",
  payment_recorded: "Payment recorded",
  payment_deleted: "Payment deleted",
  written_off: "Remainder written off",
  voided: "Voided",
  duplicated: "Created as a copy",
  converted: "Converted to an invoice",
  quote_accepted: "Accepted by the client",
  quote_declined: "Declined by the client",
  viewed: "Viewed by the client",
  invoice_overdue: "Became overdue",
  quote_expired: "Expired",
  send_failed: "Send failed",
  email_bounced: "Email bounced",
  email_complained: "Marked as spam",
  email_unsubscribed: "Recipient unsubscribed",
  reminder_sent: "Reminder sent",
  link_reset: "Public link reset",
  email_marked_sent: "Email marked as sent after review",
  email_sent_again: "Email queued again after review",
};

/** The title and an optional detail line for an activity row. */
export function activityText(
  entry: ActivityEntry,
  currency: string,
): { title: string; detail: string | null } {
  const title = ACTIVITY_LABELS[entry.type] ?? entry.type.replace(/_/g, " ");
  const data = entry.data ?? {};
  let detail: string | null = null;
  if (typeof data.amount === "number") {
    detail = formatMoney(data.amount, currency);
    if (typeof data.paidOn === "string") detail += ` on ${formatDate(data.paidOn)}`;
  } else if (entry.type === "revised" && typeof data.revisionNumber === "number") {
    detail = `Revision ${data.revisionNumber}`;
  } else if (entry.type === "sent" && data.trigger === "auto") {
    detail = "Sent automatically";
  } else if (entry.type === "reminder_sent" && typeof data.offsetDays === "number") {
    detail = `${reminderOffsetText(data.offsetDays)}${data.trigger === "auto" ? " · Sent automatically" : ""}`;
  } else if (
    (entry.type === "email_marked_sent" || entry.type === "email_sent_again") &&
    typeof data.priorStatus === "string"
  ) {
    detail = `The email was in ${data.priorStatus.replace(/_/g, " ")}`;
  } else if (entry.type === "send_failed" && typeof data.message === "string") {
    detail = data.message;
  } else if (typeof data.comment === "string" && data.comment) {
    detail = `“${data.comment}”`;
  }
  return { title, detail };
}

/** A timestamp as "23 Oct 2026, 14:05" in the browser's timezone. */
export function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** The route of a document's detail page. */
export function documentPath(kind: DocumentKind): "/invoices/$documentId" | "/quotes/$documentId" {
  return kind === "invoice" ? "/invoices/$documentId" : "/quotes/$documentId";
}

export function editPath(
  kind: DocumentKind,
): "/invoices/$documentId/edit" | "/quotes/$documentId/edit" {
  return kind === "invoice" ? "/invoices/$documentId/edit" : "/quotes/$documentId/edit";
}
