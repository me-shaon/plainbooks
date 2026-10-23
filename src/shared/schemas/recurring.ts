// Recurring schedule validation and API shapes (U15), shared by the Worker and the web app.
import { z } from "zod";
import {
  RECURRING_FREQUENCIES,
  type RecurringFrequency,
  type RecurringStatus,
  SEND_MODE_SETTINGS,
  type SendMode,
  type SendModeSetting,
} from "../domain";
import { paymentTermsDays } from "./client";
import {
  type DiscountValue,
  type DisplayStatus,
  type DocumentLineView,
  discountInput,
  isoDate,
  lineInput,
  MAX_LINES,
} from "./document";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullish()
    .transform((value) => (value ? value : null));

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const RECURRING_STATUS_LABELS: Record<RecurringStatus, string> = {
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};

const endAfterStart = (value: { startDate?: string; endDate?: string | null }) =>
  !value.startDate || !value.endDate || value.endDate >= value.startDate;
const endMessage = {
  message: "The end date must be on or after the start date",
  path: ["endDate"],
};

/** POST /api/recurring: a schedule made from an invoice. */
export const recurringCreateInput = z
  .object({
    sourceDocumentId: z.string().min(1, "Choose an invoice"),
    name: optionalText(120),
    frequency: z.enum(RECURRING_FREQUENCIES),
    startDate: isoDate,
    endDate: isoDate.nullish().transform((v) => v ?? null),
    sendMode: z.enum(SEND_MODE_SETTINGS).default("inherit"),
  })
  .refine(endAfterStart, endMessage);
export type RecurringCreateInput = z.input<typeof recurringCreateInput>;

/** PATCH /api/recurring/:id. Lines replace the schedule's own copy. */
export const recurringUpdateInput = z
  .object({
    name: optionalText(120),
    frequency: z.enum(RECURRING_FREQUENCIES),
    startDate: isoDate,
    endDate: isoDate.nullable(),
    sendMode: z.enum(SEND_MODE_SETTINGS),
    /** Null means the client terms, then the workspace terms. */
    paymentTermsDays: paymentTermsDays.nullable(),
    lines: z
      .array(lineInput)
      .min(1, "Add at least one line")
      .max(MAX_LINES, `Add ${MAX_LINES} lines or fewer`),
    discount: discountInput,
    notes: optionalText(5000),
    footerText: optionalText(2000),
    templateId: z.string().min(1).nullable(),
  })
  .partial()
  .refine(endAfterStart, endMessage);
export type RecurringUpdateInput = z.input<typeof recurringUpdateInput>;
export type RecurringUpdateData = z.output<typeof recurringUpdateInput>;

/** One row of GET /api/recurring. */
export interface RecurringSummary {
  id: string;
  name: string | null;
  clientId: string;
  clientName: string;
  currency: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate: string | null;
  /** The next issue date the scheduler creates. */
  nextIssueDate: string;
  status: RecurringStatus;
  pausedReason: string | null;
  sendMode: SendModeSetting;
  /** The mode that applies: the schedule, then the client, then the workspace. */
  resolvedSendMode: SendMode;
  /** The total of one invoice, in minor units. */
  total: number;
  lastPeriodId: string | null;
}

export interface RecurringInvoice {
  id: string;
  number: string | null;
  status: string;
  displayStatus: DisplayStatus;
  issueDate: string | null;
  total: number;
  periodId: string | null;
}

/** GET /api/recurring/:id. */
export interface RecurringDetail extends RecurringSummary {
  sourceDocumentId: string | null;
  paymentTermsDays: number | null;
  discount: DiscountValue;
  notes: string | null;
  footerText: string | null;
  templateId: string | null;
  lines: DocumentLineView[];
  /** The next few issue dates, for the schedule preview. */
  upcoming: string[];
  /** Invoices this schedule created, newest first. */
  invoices: RecurringInvoice[];
}

/** A short text for a paused or ended schedule. */
export function pausedReasonText(reason: string | null): string | null {
  if (reason === "client_archived") return "Paused because the client is archived";
  if (reason === "manual") return "Paused";
  return null;
}
