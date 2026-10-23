// Client emails for invoices, quotes, revised invoices, and reminders.
import { longDate, money } from "../../render/format";
import { html, multiline } from "../html";
import { type EmailContent, layout, summaryTable, textSummary } from "./layout";

export interface DocumentEmailInput {
  kind: "invoice" | "quote";
  number: string;
  /** The business name from the brand kit, or the workspace name. */
  from: string;
  clientName: string;
  contactName?: string | null;
  currency: string;
  /** Minor units. */
  total: number;
  /** Minor units still owed (invoices). Defaults to the total. */
  balance?: number;
  dueDate?: string | null;
  expiryDate?: string | null;
  publicUrl: string;
  accent?: string | null;
  /** The sender's own message. Plain text. */
  message?: string | null;
  /** Overrides the default subject. */
  subject?: string | null;
  footer?: string | null;
  /** True when this is revision 2 or later of a sent invoice. */
  revised?: boolean;
}

function greeting(input: { contactName?: string | null; clientName: string }): string {
  return `Hello ${input.contactName || input.clientName},`;
}

function rowsOf(input: DocumentEmailInput): [string, string][] {
  const rows: [string, string][] = [
    [input.kind === "invoice" ? "Invoice" : "Quote", input.number],
    ["Total", money(input.total, input.currency)],
  ];
  if (input.kind === "invoice" && input.balance !== undefined && input.balance !== input.total) {
    rows.push(["Balance due", money(input.balance, input.currency)]);
  }
  if (input.kind === "invoice" && input.dueDate) rows.push(["Due", longDate(input.dueDate)]);
  if (input.kind === "quote" && input.expiryDate) {
    rows.push(["Valid until", longDate(input.expiryDate)]);
  }
  return rows;
}

function build(input: DocumentEmailInput, subject: string, intro: string, action: string) {
  const rows = rowsOf(input);
  const message = input.message?.trim();
  const body = html`<p style="margin:0 0 12px">${greeting(input)}</p><p style="margin:0 0 12px">${intro}</p>${
    message ? html`<p style="margin:0 0 12px">${multiline(message)}</p>` : ""
  }${summaryTable(rows)}<p style="margin:0;color:#6b6b66">The PDF is attached.</p>`;
  const text = [
    greeting(input),
    "",
    intro,
    ...(message ? ["", message] : []),
    "",
    textSummary(rows),
    "",
    `${action}: ${input.publicUrl}`,
    "The PDF is attached.",
    "",
    input.footer || input.from,
  ].join("\n");
  return {
    subject: input.subject?.trim() || subject,
    html: layout({
      accent: input.accent,
      from: input.from,
      preheader: intro,
      body,
      action: { label: action, url: input.publicUrl },
      footer: input.footer,
    }),
    text,
  };
}

export function invoiceEmail(input: DocumentEmailInput): EmailContent {
  if (input.revised) return revisedInvoiceEmail(input);
  return build(
    input,
    `Invoice ${input.number} from ${input.from}`,
    `${input.from} sent you invoice ${input.number} for ${money(input.total, input.currency)}.`,
    "View invoice",
  );
}

export function revisedInvoiceEmail(input: DocumentEmailInput): EmailContent {
  return build(
    input,
    `Updated invoice ${input.number} from ${input.from}`,
    `${input.from} updated invoice ${input.number}. This version replaces the earlier one.`,
    "View invoice",
  );
}

export function quoteEmail(input: DocumentEmailInput): EmailContent {
  return build(
    input,
    `Quote ${input.number} from ${input.from}`,
    `${input.from} sent you quote ${input.number} for ${money(input.total, input.currency)}. You can accept or decline it online.`,
    "View quote",
  );
}

export function documentEmail(input: DocumentEmailInput): EmailContent {
  return input.kind === "invoice" ? invoiceEmail(input) : quoteEmail(input);
}

export interface ReminderEmailInput extends DocumentEmailInput {
  /** Days from the due date: negative before, positive after. */
  offsetDays: number;
}

/** A payment reminder (U16). */
export function reminderEmail(input: ReminderEmailInput): EmailContent {
  const due = longDate(input.dueDate);
  const intro =
    input.offsetDays < 0
      ? `This is a reminder that invoice ${input.number} is due on ${due}.`
      : input.offsetDays === 0
        ? `This is a reminder that invoice ${input.number} is due today.`
        : `Invoice ${input.number} was due on ${due} and is now overdue.`;
  const subject =
    input.offsetDays > 0
      ? `Overdue: invoice ${input.number} from ${input.from}`
      : `Reminder: invoice ${input.number} from ${input.from}`;
  return build({ ...input, kind: "invoice", revised: false }, subject, intro, "View invoice");
}
