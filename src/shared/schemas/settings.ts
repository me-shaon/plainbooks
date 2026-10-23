// Workspace settings, brand kit, and team validation shared by the API and the settings forms.
import { z } from "zod";
import {
  REMINDER_MODES,
  type ReminderMode,
  type ReminderStep,
  SEND_MODES,
  type SendMode,
  USER_ROLES,
  type UserRole,
} from "../domain";
import { currencyCode, paymentTermsDays } from "./client";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullish()
    .transform((value) => (value ? value : null));

/** True when the runtime knows the IANA time zone. */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const MAX_REMINDER_STEPS = 10;

export const reminderSchedule = z
  .array(
    z.object({
      offsetDays: z
        .int("Enter whole days")
        .min(-60, "Use 60 days before the due date or later")
        .max(365, "Use 365 days after the due date or earlier"),
    }),
  )
  .max(MAX_REMINDER_STEPS, `Add ${MAX_REMINDER_STEPS} steps or fewer`)
  .refine((steps) => new Set(steps.map((s) => s.offsetDays)).size === steps.length, {
    message: "Each reminder step needs a different day",
  })
  .transform((steps) => [...steps].sort((a, b) => a.offsetDays - b.offsetDays));

const numberPrefix = z
  .string()
  .trim()
  .max(12, "Use 12 characters or fewer")
  .regex(/^[A-Za-z0-9/_.#-]*$/, "Use letters, digits, and - _ / . # only");

/** PATCH /api/settings/workspace. Every field is optional. Owner only. */
export const workspaceSettingsInput = z
  .object({
    name: z.string().trim().min(1, "Enter the workspace name").max(120),
    homeCurrency: currencyCode,
    timezone: z.string().trim().refine(isTimeZone, "Choose a valid time zone"),
    invoicePrefix: numberPrefix,
    quotePrefix: numberPrefix,
    numberPadding: z.int().min(1, "Use 1 digit or more").max(8, "Use 8 digits or fewer"),
    defaultPaymentTermsDays: paymentTermsDays,
    defaultQuoteValidityDays: z.int("Enter whole days").min(1, "Enter 1 day or more").max(365),
    defaultTemplateId: z.string().min(1).nullable(),
    defaultTaxRateId: z.string().min(1).nullable(),
    reminderMode: z.enum(REMINDER_MODES),
    recurringSendMode: z.enum(SEND_MODES),
    reminderSchedule,
    emailFromName: optionalText(80),
    emailFromAddress: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.union([z.literal(""), z.email("Enter a valid email address")]))
      .nullish()
      .transform((value) => (value ? value : null)),
    replyToEmail: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.union([z.literal(""), z.email("Enter a valid email address")]))
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .partial();
export type WorkspaceSettingsInput = z.input<typeof workspaceSettingsInput>;

export const FONT_CHOICES = [
  { id: "instrument-sans", label: "Instrument Sans", stack: '"Instrument Sans", sans-serif' },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", stack: '"IBM Plex Sans", sans-serif' },
  { id: "source-serif-4", label: "Source Serif 4", stack: '"Source Serif 4", serif' },
] as const;
export type FontChoice = (typeof FONT_CHOICES)[number]["id"];
const FONT_IDS = FONT_CHOICES.map((f) => f.id) as [FontChoice, ...FontChoice[]];

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** PATCH /api/settings/brand-kit. Every field is optional. Owner only. */
export const brandKitInput = z
  .object({
    businessName: optionalText(120),
    accentColor: z
      .string()
      .trim()
      .regex(HEX_COLOR, "Enter a hex color such as #2f7f6f")
      .transform((value) => value.toLowerCase()),
    font: z.enum(FONT_IDS),
    address: optionalText(1000),
    taxId: optionalText(100),
    bankDetails: optionalText(2000),
    footerText: optionalText(1000),
  })
  .partial();
export type BrandKitInput = z.input<typeof brandKitInput>;

/** POST /api/team. Owner only. The person still needs Cloudflare Access permission. */
export const teamMemberInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  name: optionalText(120),
  role: z.enum(USER_ROLES).default("member"),
});
export type TeamMemberInput = z.input<typeof teamMemberInput>;

/** PATCH /api/team/:id. Owner only. */
export const teamRoleInput = z.object({ role: z.enum(USER_ROLES) });

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------

export const MAX_LOGO_BYTES = 1024 * 1024;

export const LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
} as const;
export type LogoContentType = keyof typeof LOGO_TYPES;
export type LogoExtension = (typeof LOGO_TYPES)[LogoContentType];

/** The public URL of a logo stored at `logos/<sha256>.<ext>`. */
export function logoUrl(logoKey: string | null): string | null {
  if (!logoKey) return null;
  return `/p/assets/logo/${logoKey.replace(/^logos\//, "")}`;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** GET /api/settings/workspace. */
export interface WorkspaceSettings {
  name: string;
  homeCurrency: string;
  /** True after the first invoice was sent. The home currency can no longer change. */
  homeCurrencyLocked: boolean;
  timezone: string;
  invoicePrefix: string;
  quotePrefix: string;
  numberPadding: number;
  defaultPaymentTermsDays: number;
  defaultQuoteValidityDays: number;
  defaultTemplateId: string | null;
  defaultTaxRateId: string | null;
  reminderMode: ReminderMode;
  recurringSendMode: SendMode;
  reminderSchedule: ReminderStep[];
  overdueReminderCap: number;
  emailFromName: string | null;
  /** The sender address. It must be on a domain verified in Resend. */
  emailFromAddress: string | null;
  replyToEmail: string | null;
}

/** GET /api/settings/brand-kit. */
export interface BrandKit {
  businessName: string | null;
  /** R2 key, for example "logos/<sha256>.png". */
  logoKey: string | null;
  /** Public URL, for example "/p/assets/logo/<sha256>.png". */
  logoUrl: string | null;
  accentColor: string;
  font: string;
  address: string | null;
  taxId: string | null;
  bankDetails: string | null;
  footerText: string | null;
}

/** One row of GET /api/team. */
export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: number;
}

/** "INV-0042" style example for the numbering preview. */
export function exampleNumber(prefix: string, padding: number, value = 1): string {
  return `${prefix}${String(value).padStart(padding, "0")}`;
}

/** "3 days before due", "On the due date", "7 days after due". */
export function reminderStepLabel(offsetDays: number): string {
  if (offsetDays === 0) return "On the due date";
  const days = Math.abs(offsetDays);
  const unit = days === 1 ? "day" : "days";
  return offsetDays < 0 ? `${days} ${unit} before due` : `${days} ${unit} after due`;
}
