// Email provider settings shared by the API and the Settings > Email screen.
import { z } from "zod";
import type { EmailProviderRole } from "../domain";

/** The largest daily cap the form accepts. */
export const MAX_DAILY_CAP = 1_000_000;

/**
 * PUT /api/settings/email/primary and /fallback. Owner only.
 *
 * - An empty secret field keeps the saved value when the provider stays the same.
 * - `webhookSecret` undefined keeps the saved secret. Null or "" removes it.
 * - `dailyCap` null or undefined means the default cap.
 */
export const emailProviderInput = z.object({
  providerId: z.string().trim().min(1, "Choose a provider").max(64),
  presetId: z.string().trim().max(64).nullish(),
  credentials: z.record(z.string(), z.string().max(4096, "Use 4096 characters or fewer")),
  webhookSecret: z.string().max(4096, "Use 4096 characters or fewer").nullish(),
  dailyCap: z
    .int("Enter a whole number")
    .min(1, "Enter 1 or more, or leave it empty for the default")
    .max(MAX_DAILY_CAP, `Use ${MAX_DAILY_CAP} or less`)
    .nullish(),
});
export type EmailProviderInput = z.input<typeof emailProviderInput>;

/** POST /api/settings/email/test. The role defaults to the primary. */
export const testEmailInput = z.object({
  role: z.enum(["primary", "fallback"]).optional(),
});

/** One input of a provider form, from the mailswitch catalog. */
export interface EmailCredentialField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  hint?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: readonly { value: string; label: string }[];
}

/** A preset of a provider form, for example SMTP with Gmail. */
export interface EmailProviderPreset {
  id: string;
  name: string;
  /** Values the preset sets. The form shows them read-only. */
  fixed: Readonly<Record<string, string>>;
  fieldHints?: Readonly<Record<string, { label?: string; hint?: string; placeholder?: string }>>;
  defaultDailyCap?: number;
}

/** How the form asks for the webhook secret of a provider. */
export interface WebhookSecretField {
  label: string;
  hint: string;
  placeholder?: string;
}

/** One provider the Owner can pick. */
export interface EmailProviderOption {
  id: string;
  name: string;
  docsUrl: string;
  credentialFields: readonly EmailCredentialField[];
  presets: readonly EmailProviderPreset[];
  /** Null when the provider has no webhooks that PlainBooks reads. */
  webhookSecret: WebhookSecretField | null;
  /** The provider cap when no preset applies, or null for no cap. */
  defaultDailyCap: number | null;
}

/** What Settings shows for one saved role. It never holds a secret. */
export interface EmailProviderView {
  role: EmailProviderRole;
  providerId: string;
  presetId: string | null;
  dailyCap: number | null;
  defaultDailyCap: number | null;
  updatedAt: number;
  configured: true;
  /** True when the stored keys do not decrypt. The form then asks for every key. */
  needsReentry: boolean;
  /** The values of the fields that are not secret. */
  values: Record<string, string>;
  /** For each secret field, true when a value is saved. */
  secrets: Record<string, boolean>;
  webhookSecretConfigured: boolean;
}

/** GET /api/settings/email. */
export interface EmailSettings {
  providers: EmailProviderOption[];
  /** The provider that a new form selects. */
  defaultProviderId: string;
  settings: Record<EmailProviderRole, EmailProviderView | null>;
  /** The URL to give each provider for bounce and complaint webhooks. */
  webhookUrls: Record<EmailProviderRole, string>;
}

/** POST /api/settings/email/test. */
export type TestEmailResult =
  | { status: "sent"; to: string }
  | { status: "not_sent" | "unknown"; to: string; reason: string; message: string };
