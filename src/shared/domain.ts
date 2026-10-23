// Domain enums and JSON shapes shared by the database schema, the API, and the web app.

export const DOCUMENT_KINDS = ["invoice", "quote"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Stored invoice statuses. "finalized" means a number is allocated but the send did not
 * complete ("Ready to send"). "Overdue" is derived from the due date and the balance, and
 * the scheduler caches it in `documents.is_overdue` for list filters.
 */
export const INVOICE_STATUSES = [
  "draft",
  "finalized",
  "sent",
  "partially_paid",
  "paid",
  "void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "converted",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Every stored status of either kind. A CHECK constraint ties each status to its kind. */
export const DOCUMENT_STATUSES = [
  "draft",
  "finalized",
  "sent",
  "partially_paid",
  "paid",
  "void",
  "accepted",
  "declined",
  "expired",
  "converted",
] as const satisfies readonly (InvoiceStatus | QuoteStatus)[];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const USER_ROLES = ["owner", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Reminder mode on the workspace. Clients and documents add "inherit". */
export const REMINDER_MODES = ["suggest", "auto_send", "off"] as const;
export type ReminderMode = (typeof REMINDER_MODES)[number];
export const REMINDER_MODE_SETTINGS = ["inherit", ...REMINDER_MODES] as const;
export type ReminderModeSetting = (typeof REMINDER_MODE_SETTINGS)[number];

/** Recurring send mode on the workspace. Clients and schedules add "inherit". */
export const SEND_MODES = ["draft", "auto_send"] as const;
export type SendMode = (typeof SEND_MODES)[number];
export const SEND_MODE_SETTINGS = ["inherit", ...SEND_MODES] as const;
export type SendModeSetting = (typeof SEND_MODE_SETTINGS)[number];

export const DISCOUNT_TYPES = ["none", "percent", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const FX_PROVIDERS = ["frankfurter", "manual", "identity"] as const;
export type FxProvider = (typeof FX_PROVIDERS)[number];

export const PAYMENT_KINDS = ["payment", "write_off"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_STATUSES = ["active", "paused", "ended"] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

export const JOB_STATUSES = ["pending", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TEMPLATE_LAYOUTS = ["classic", "minimal", "bold"] as const;
export type TemplateLayout = (typeof TEMPLATE_LAYOUTS)[number];

export const TEMPLATE_SECTIONS = [
  "header",
  "bill_to",
  "line_items",
  "totals",
  "notes",
  "payment_details",
  "footer",
] as const;
export type TemplateSection = (typeof TEMPLATE_SECTIONS)[number];

export interface TemplateConfig {
  layout: TemplateLayout;
  sections: { id: TemplateSection; visible: boolean }[];
  customFields: { fieldId: string; section: TemplateSection }[];
}

export const CUSTOM_FIELD_TYPES = ["text", "number", "date"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_SCOPES = ["workspace", "client", "document"] as const;
export type CustomFieldScope = (typeof CUSTOM_FIELD_SCOPES)[number];

export const EMAIL_KINDS = ["document", "reminder", "notification"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_STATUSES = ["sent", "failed", "bounced", "complained"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const TRIGGERS = ["manual", "auto"] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** One reminder step, in days relative to the due date (negative is before). */
export interface ReminderStep {
  offsetDays: number;
}

export const DEFAULT_REMINDER_SCHEDULE: ReminderStep[] = [
  { offsetDays: -3 },
  { offsetDays: 0 },
  { offsetDays: 7 },
  { offsetDays: 14 },
  { offsetDays: 21 },
];

export const OVERDUE_REMINDER_CAP = 3;
