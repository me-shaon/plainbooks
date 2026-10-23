// Reminder API shapes (U16), shared by the Worker and the web app.
import { z } from "zod";
import {
  REMINDER_MODE_SETTINGS,
  type ReminderMode,
  type ReminderModeSetting,
  type Trigger,
} from "../domain";
import type { DisplayStatus } from "./document";

/** PATCH /api/documents/:id/reminder-mode. Works on sent invoices too. */
export const reminderModeInput = z.object({ reminderMode: z.enum(REMINDER_MODE_SETTINGS) });
export type ReminderModeInput = z.input<typeof reminderModeInput>;

/** One row of GET /api/reminders/suggestions (the dashboard "needs reminder" list). */
export interface ReminderSuggestion {
  documentId: string;
  number: string | null;
  clientId: string;
  clientName: string;
  currency: string;
  total: number;
  balance: number;
  dueDate: string;
  displayStatus: DisplayStatus;
  /** Days from the due date today: negative before, positive after. */
  offsetDays: number;
  /** The schedule step that is due, in days from the due date. */
  stepOffsetDays: number;
  overdueSent: number;
  overdueCap: number;
  lastReminderAt: number | null;
}

export interface ReminderHistoryEntry {
  at: number;
  offsetDays: number | null;
  trigger: Trigger;
  status: string;
}

/** GET /api/documents/:id/reminders: the reminder panel on the invoice page. */
export interface ReminderStatus {
  invoiceMode: ReminderModeSetting;
  clientMode: ReminderModeSetting;
  workspaceMode: ReminderMode;
  /** "off" on the invoice or the client wins. Then invoice, client, workspace. */
  mode: ReminderMode;
  offsetDays: number | null;
  /** The step that is due now, or null. */
  dueStep: number | null;
  overdueSent: number;
  overdueCap: number;
  /** True when the invoice has an open balance and a manual reminder is allowed now. */
  canSend: boolean;
  /** Why a manual reminder is not allowed, when `canSend` is false. */
  blockedReason: string | null;
  history: ReminderHistoryEntry[];
}

/** Text for a reminder offset, for example "3 days before due" or "7 days overdue". */
export function reminderOffsetText(offsetDays: number): string {
  if (offsetDays === 0) return "Due today";
  const days = Math.abs(offsetDays);
  const unit = days === 1 ? "day" : "days";
  return offsetDays < 0 ? `Due in ${days} ${unit}` : `${days} ${unit} overdue`;
}
