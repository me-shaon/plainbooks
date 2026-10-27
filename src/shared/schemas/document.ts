// Quote and invoice validation and API shapes shared by the Worker and the web app.
import { z } from "zod";
import {
  type CustomFieldType,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentStatus,
  type FxProvider,
  type PaymentKind,
  REMINDER_MODE_SETTINGS,
  type ReminderModeSetting,
  type TemplateConfig,
  type TemplateSection,
} from "../domain";
import {
  type ConvertedTotals,
  type DocumentTotals,
  formatScaled,
  normalizePercent,
  normalizeRate,
  parseQuantity,
  QUANTITY_DECIMALS,
} from "../money";
import { isIsoDate } from "../time";
import { currencyCode, paymentTermsDays } from "./client";
import type { BrandKit } from "./settings";

export const MAX_LINES = 100;
export const MAX_DECISION_COMMENT = 1000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullish()
    .transform((value) => (value ? value : null));

export const isoDate = z.string().trim().refine(isIsoDate, "Enter a valid date (YYYY-MM-DD)");

const minorAmount = z
  .int("Enter the amount in minor units")
  .min(0, "Enter 0 or more")
  .max(Number.MAX_SAFE_INTEGER, "The amount is too large");

function stripZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** A quantity with up to 3 decimals, normalized to a short decimal string. */
export const quantity = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    return stripZeros(formatScaled(BigInt(parseQuantity(value)), QUANTITY_DECIMALS));
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Enter a quantity of 0 or more, with 3 decimals at most",
    });
    return z.NEVER;
  }
});

export const lineInput = z.object({
  description: z.string().trim().max(2000, "Use 2000 characters or fewer").default(""),
  quantity: quantity.default("1"),
  /** Minor units, excluding tax. */
  unitPrice: minorAmount,
  taxRateId: z.string().min(1).nullish().default(null),
});
export type LineInputData = z.output<typeof lineInput>;

export const discountInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("percent"),
    percent: z.union([z.string(), z.number()]).transform((value, ctx) => {
      try {
        return normalizePercent(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Enter a percent between 0 and 100" });
        return z.NEVER;
      }
    }),
  }),
  z.object({ type: z.literal("fixed"), amount: minorAmount }),
]);
export type DiscountValue = z.output<typeof discountInput>;

/** A rate the user typed in: one document unit = `rate` home units, as of `date`. */
export const manualFxInput = z.object({
  rate: z.union([z.string(), z.number()]).transform((value, ctx) => {
    try {
      const rate = normalizeRate(String(value));
      if (rate === "0") throw new Error("zero");
      return rate;
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a rate above 0 with 8 decimals at most" });
      return z.NEVER;
    }
  }),
  date: isoDate,
});

export const customFieldValueInput = z.object({
  fieldId: z.string().min(1),
  value: z.string().trim().max(500, "Use 500 characters or fewer"),
});

const draftFields = {
  clientId: z.string().min(1, "Choose a client"),
  /** Defaults to the client's currency. */
  currency: currencyCode,
  lines: z.array(lineInput).max(MAX_LINES, `Add ${MAX_LINES} lines or fewer`),
  discount: discountInput,
  /** Null means "the send date". */
  issueDate: isoDate.nullable(),
  /** Invoices. Null means issue date plus payment terms. */
  dueDate: isoDate.nullable(),
  /** Invoices. Null means the client terms, then the workspace terms. */
  paymentTermsDays: paymentTermsDays.nullable(),
  /** Quotes. Null means issue date plus the workspace quote validity. */
  expiryDate: isoDate.nullable(),
  notes: optionalText(5000),
  footerText: optionalText(2000),
  /** Template override. Null means the client default, then the workspace default. */
  templateId: z.string().min(1).nullable(),
  reminderMode: z.enum(REMINDER_MODE_SETTINGS),
  /** Manual exchange rate. Null clears the override, so send fetches the rate. */
  fxRate: manualFxInput.nullable(),
  /** Document-level custom field values. Replaces the whole list when present. */
  customFields: z.array(customFieldValueInput).max(50),
};

/** POST /api/documents. */
export const documentCreateInput = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  clientId: draftFields.clientId,
  currency: draftFields.currency.optional(),
  lines: draftFields.lines.default([]),
  discount: draftFields.discount.default({ type: "none" }),
  issueDate: draftFields.issueDate.default(null),
  dueDate: draftFields.dueDate.default(null),
  paymentTermsDays: draftFields.paymentTermsDays.default(null),
  expiryDate: draftFields.expiryDate.default(null),
  notes: draftFields.notes,
  footerText: draftFields.footerText,
  templateId: draftFields.templateId.default(null),
  reminderMode: draftFields.reminderMode.default("inherit"),
  fxRate: draftFields.fxRate.default(null),
  customFields: draftFields.customFields.default([]),
});
export type DocumentCreateInput = z.input<typeof documentCreateInput>;
export type DocumentCreateData = z.output<typeof documentCreateInput>;

/** PATCH /api/documents/:id (drafts) and POST /api/documents/:id/revise. All optional. */
export const documentUpdateInput = z.object(draftFields).partial();
export type DocumentUpdateInput = z.input<typeof documentUpdateInput>;
export type DocumentUpdateData = z.output<typeof documentUpdateInput>;

/** POST /api/documents/:id/finalize. */
export const finalizeInput = z.object({ issueDate: isoDate.optional() });

export const LIST_FILTERS = ["all", "unpaid", "overdue", "drafts"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

/** GET /api/documents query. */
export const documentListQuery = z.object({
  kind: z.enum(DOCUMENT_KINDS).optional(),
  /** The segmented filter: unpaid = sent or partially paid, overdue, drafts. */
  filter: z.enum(LIST_FILTERS).default("all"),
  status: z.string().optional(),
  clientId: z.string().min(1).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type DocumentListQuery = z.input<typeof documentListQuery>;

/** POST /api/documents/:id/payments. */
export const paymentInput = z.object({
  /** Minor units in the invoice currency. */
  amount: z.int("Enter the amount in minor units").min(1, "Enter an amount above 0"),
  paidOn: isoDate,
  note: optionalText(500),
});
export type PaymentInput = z.input<typeof paymentInput>;

/** POST /api/documents/:id/write-off. */
export const writeOffInput = z.object({
  paidOn: isoDate.optional(),
  note: optionalText(500),
});

/** POST /p/:token/decision (U11). */
export const quoteDecisionInput = z.object({
  decision: z.enum(["accept", "decline"]),
  comment: optionalText(MAX_DECISION_COMMENT),
});
export type QuoteDecisionInput = z.input<typeof quoteDecisionInput>;

// ---------------------------------------------------------------------------
// Snapshot: the frozen content of one revision. Rendering reads only this.
// ---------------------------------------------------------------------------

export interface SnapshotLine {
  position: number;
  description: string;
  quantity: string;
  unitPrice: number;
  tax: { id: string; name: string; rate: string; note: string | null } | null;
  /** quantity x unit price. */
  amount: number;
  /** This line's share of the document discount. */
  discount: number;
  net: number;
  taxAmount: number;
}

export interface SnapshotCustomField {
  fieldId: string;
  label: string;
  type: CustomFieldType;
  section: TemplateSection;
  value: string;
}

export interface DocumentSnapshot {
  version: 1;
  document: {
    id: string;
    kind: DocumentKind;
    /** Null only in a transient draft preview. */
    number: string | null;
    /** 0 in a transient draft preview. */
    revisionNumber: number;
    currency: string;
    issueDate: string;
    dueDate: string | null;
    expiryDate: string | null;
    paymentTermsDays: number | null;
    discount: DiscountValue;
    notes: string | null;
    footerText: string | null;
  };
  lines: SnapshotLine[];
  totals: DocumentTotals;
  /** Null only in a draft preview without a known rate. */
  fx: {
    homeCurrency: string;
    rate: string;
    rateDate: string;
    provider: FxProvider;
    overridden: boolean;
  } | null;
  homeTotals: ConvertedTotals | null;
  client: {
    id: string;
    name: string;
    billingAddress: string | null;
    taxId: string | null;
    contact: { name: string | null; email: string } | null;
  };
  brandKit: BrandKit;
  template: { id: string | null; name: string; config: TemplateConfig };
  /** Values from workspace, client, and document scopes. Empty values are left out. */
  customFields: SnapshotCustomField[];
  /** When the snapshot was built (ms). */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

/** Stored status plus the derived ones ("overdue" for invoices, "expired" for quotes). */
export type DisplayStatus = DocumentStatus | "overdue";

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  displayStatus: DisplayStatus;
  number: string | null;
  clientId: string;
  clientName: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  expiryDate: string | null;
  total: number;
  amountPaid: number;
  balance: number;
  isOverdue: boolean;
  updatedAt: number;
  /** The first line's description. Only list rows have it. */
  summary?: string | null;
}

export interface DocumentLineView {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: number;
  taxRateId: string | null;
}

export interface PaymentView {
  id: string;
  kind: PaymentKind;
  amount: number;
  homeAmount: number;
  paidOn: string;
  note: string | null;
  createdAt: number;
}

export interface RevisionSummary {
  id: string;
  revisionNumber: number;
  issueDate: string;
  total: number;
  createdAt: number;
}

export interface DocumentDetail extends DocumentSummary {
  paymentTermsDays: number | null;
  discount: DiscountValue;
  notes: string | null;
  footerText: string | null;
  templateId: string | null;
  reminderMode: ReminderModeSetting;
  fx: {
    rate: string | null;
    rateDate: string | null;
    provider: FxProvider | null;
    overridden: boolean;
  };
  publicToken: string | null;
  currentRevisionId: string | null;
  revisionCount: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  sourceQuoteId: string | null;
  convertedInvoiceId: string | null;
  decidedAt: number | null;
  decisionComment: string | null;
  finalizedAt: number | null;
  sentAt: number | null;
  paidAt: number | null;
  voidedAt: number | null;
  lines: DocumentLineView[];
  payments: PaymentView[];
  customFields: { fieldId: string; value: string }[];
}

export interface ActivityEntry {
  id: string;
  type: string;
  actorUserId: string | null;
  data: Record<string, unknown> | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Derived statuses
// ---------------------------------------------------------------------------

export interface StatusFields {
  kind: DocumentKind;
  status: DocumentStatus;
  number: string | null;
  dueDate: string | null;
  expiryDate: string | null;
  total: number;
  amountPaid: number;
}

/** Invoice statuses with an open balance. */
export const OPEN_STATUSES = ["sent", "partially_paid"] as const;

/**
 * True when an invoice is sent or partially paid, its due date is before `today`
 * (workspace timezone), and it has a balance above zero. The SQL form is
 * `overdueCondition` in src/worker/services/status-sql.ts. Keep the two the same.
 */
export function isOverdue(doc: StatusFields, today: string): boolean {
  return (
    doc.kind === "invoice" &&
    (OPEN_STATUSES as readonly string[]).includes(doc.status) &&
    doc.dueDate !== null &&
    doc.dueDate < today &&
    doc.total - doc.amountPaid > 0
  );
}

/** True when a sent quote is past its expiry date. The scheduler later stores "expired". */
export function isQuoteExpired(doc: StatusFields, today: string): boolean {
  return (
    doc.kind === "quote" &&
    doc.status === "sent" &&
    doc.expiryDate !== null &&
    doc.expiryDate < today
  );
}

/**
 * The status to show. Adds "overdue" for invoices and "expired" for quotes from dates. A
 * quote that has a number but is still a draft (send failed) shows as "finalized".
 */
export function displayStatus(doc: StatusFields, today: string): DisplayStatus {
  if (isOverdue(doc, today)) return "overdue";
  if (isQuoteExpired(doc, today)) return "expired";
  if (doc.kind === "quote" && doc.status === "draft" && doc.number !== null) return "finalized";
  return doc.status;
}

/** GET /api/fx/rate and the send preview: a rate to the home currency, or why there is none. */
export type FxQuote =
  | {
      status: "ok";
      /** One document unit = `rate` home units. */
      rate: string;
      /** The provider's effective date. */
      rateDate: string;
      provider: FxProvider;
    }
  | { status: "manual_required"; message: string };

/** GET /api/documents/:id/send-preview: what the send dialog shows before it sends. */
export interface SendPreview {
  /** The client's primary and billing contacts, primary first. */
  recipients: string[];
  /** The default subject. The number is the next free number for an unnumbered draft. */
  subject: string;
  /** True when the workspace has a sender address and a usable email provider. */
  emailConfigured: boolean;
  /** Sends in the rolling 24 hours, summed over the providers that have a daily cap. */
  emailsSentToday: number;
  /** The summed daily caps, or null when a provider has no cap. */
  dailyLimit: number | null;
  /** The issue date the send will use. */
  issueDate: string;
  homeCurrency: string;
  /** Null when the document is in the home currency. */
  fx: FxQuote | null;
}
