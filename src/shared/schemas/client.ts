// Client validation shared by the API and the client form.
import { z } from "zod";
import {
  type DocumentKind,
  type DocumentStatus,
  type PaymentKind,
  REMINDER_MODE_SETTINGS,
  type RecurringFrequency,
  type RecurringStatus,
  type ReminderModeSetting,
  SEND_MODE_SETTINGS,
  type SendModeSetting,
} from "../domain";
import { isCurrencyCode } from "../money";
import type { DisplayStatus } from "./document";

/** Trims text. Empty text becomes null, so optional fields clear cleanly. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullish()
    .transform((value) => (value ? value : null));

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrencyCode, "Choose a supported currency");

/** Days from the issue date to the due date. */
export const paymentTermsDays = z
  .int("Enter whole days")
  .min(0, "Enter 0 or more days")
  .max(365, "Enter 365 days or fewer");

export const MAX_CONTACTS = 20;

export const contactInput = z.object({
  name: optionalText(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  isPrimary: z.boolean().default(false),
  isBilling: z.boolean().default(false),
});
export type ContactInput = z.input<typeof contactInput>;

const contactList = z
  .array(contactInput)
  .max(MAX_CONTACTS, `Add ${MAX_CONTACTS} contacts or fewer`)
  .refine((list) => list.filter((c) => c.isPrimary).length <= 1, {
    message: "Only one contact can be the primary contact",
  })
  .refine((list) => new Set(list.map((c) => c.email)).size === list.length, {
    message: "Each contact needs a different email address",
  });

const clientFields = {
  name: z.string().trim().min(1, "Enter the client name").max(200, "Use 200 characters or fewer"),
  billingAddress: optionalText(1000),
  taxId: optionalText(100),
  defaultCurrency: currencyCode,
  /** Null means no default tax rate. */
  defaultTaxRateId: z.string().min(1).nullish().default(null),
  /** Null means the workspace default. */
  paymentTermsDays: paymentTermsDays.nullish().default(null),
  /** Null means the workspace default template. */
  templateId: z.string().min(1).nullish().default(null),
  reminderMode: z.enum(REMINDER_MODE_SETTINGS).default("inherit"),
  recurringSendMode: z.enum(SEND_MODE_SETTINGS).default("inherit"),
  notes: optionalText(2000),
  contacts: contactList.default([]),
};

/** POST /api/clients. */
export const clientCreateInput = z.object(clientFields);
export type ClientCreateInput = z.input<typeof clientCreateInput>;
export type ClientCreateData = z.output<typeof clientCreateInput>;

/**
 * PATCH /api/clients/:id. Every field is optional. `contacts`, when present, replaces the
 * whole contact list.
 */
export const clientUpdateInput = z.object({
  name: clientFields.name.optional(),
  billingAddress: optionalText(1000).optional(),
  taxId: optionalText(100).optional(),
  defaultCurrency: currencyCode.optional(),
  defaultTaxRateId: z.string().min(1).nullable().optional(),
  paymentTermsDays: paymentTermsDays.nullable().optional(),
  templateId: z.string().min(1).nullable().optional(),
  reminderMode: z.enum(REMINDER_MODE_SETTINGS).optional(),
  recurringSendMode: z.enum(SEND_MODE_SETTINGS).optional(),
  notes: optionalText(2000).optional(),
  contacts: contactList.optional(),
});
export type ClientUpdateInput = z.input<typeof clientUpdateInput>;
export type ClientUpdateData = z.output<typeof clientUpdateInput>;

export const CLIENT_ARCHIVE_FILTERS = ["active", "archived", "all"] as const;
export type ClientArchiveFilter = (typeof CLIENT_ARCHIVE_FILTERS)[number];

/** GET /api/clients query. */
export const clientListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  archived: z.enum(CLIENT_ARCHIVE_FILTERS).default("active"),
});

/** Labels for the client default selects. */
export const REMINDER_MODE_LABELS: Record<ReminderModeSetting, string> = {
  inherit: "Workspace default",
  suggest: "Suggest reminders",
  auto_send: "Auto-send reminders",
  off: "Off",
};

export const SEND_MODE_LABELS: Record<SendModeSetting, string> = {
  inherit: "Workspace default",
  draft: "Create a draft for review",
  auto_send: "Auto-send",
};

export const OWNER_ONLY_MESSAGE = "Only an Owner can change this";

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface CurrencyAmount {
  currency: string;
  /** Minor units. */
  amount: number;
}

export interface OutstandingBalance extends CurrencyAmount {
  /** Number of open invoices in this currency. */
  count: number;
}

export interface ClientContact {
  id: string;
  name: string | null;
  email: string;
  isPrimary: boolean;
  isBilling: boolean;
}

export interface Client {
  id: string;
  name: string;
  billingAddress: string | null;
  taxId: string | null;
  defaultCurrency: string;
  defaultTaxRateId: string | null;
  paymentTermsDays: number | null;
  templateId: string | null;
  reminderMode: ReminderModeSetting;
  recurringSendMode: SendModeSetting;
  notes: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** One row of GET /api/clients. */
export interface ClientSummary {
  id: string;
  name: string;
  defaultCurrency: string;
  primaryEmail: string | null;
  archivedAt: number | null;
  outstanding: OutstandingBalance[];
}

export interface ClientDocumentSummary {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  number: string | null;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  /** The stored status plus the derived ones, from `displayStatus`. */
  displayStatus: DisplayStatus;
  isOverdue: boolean;
}

export interface ClientPayment {
  id: string;
  documentId: string;
  documentNumber: string | null;
  kind: PaymentKind;
  currency: string;
  amount: number;
  paidOn: string;
}

export interface ClientSchedule {
  id: string;
  name: string | null;
  frequency: RecurringFrequency;
  status: RecurringStatus;
  nextIssueDate: string;
}

/** GET /api/clients/:id. */
export interface ClientDetail {
  client: Client;
  contacts: ClientContact[];
  documents: ClientDocumentSummary[];
  payments: ClientPayment[];
  schedules: ClientSchedule[];
  outstanding: OutstandingBalance[];
}
