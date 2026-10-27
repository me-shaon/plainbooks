import type { ProviderAdapter, ProviderMeta, SocketConnect } from "mailswitch";
import { brevo } from "mailswitch/brevo";
import { getProviderMeta } from "mailswitch/catalog";
import { cloudflareRest } from "mailswitch/cloudflare";
import { mailersend } from "mailswitch/mailersend";
import { mailgun } from "mailswitch/mailgun";
import { mailjet } from "mailswitch/mailjet";
import { postmark } from "mailswitch/postmark";
import { resend } from "mailswitch/resend";
import { sendgrid } from "mailswitch/sendgrid";
import { ses } from "mailswitch/ses";
import { smtp } from "mailswitch/smtp";
import { smtp2go } from "mailswitch/smtp2go";
import { tosend } from "mailswitch/tosend";
import { zeptomail } from "mailswitch/zeptomail";

/**
 * The providers the Owner can pick in Settings, in the mailswitch catalog order. It is the
 * mailswitch@0.2.0 catalog without `cloudflare-binding`, because the deploy declares no
 * `send_email` binding. A test fails when the installed catalog differs from this list.
 */
export const EMAIL_PROVIDER_IDS = [
  "resend",
  "tosend",
  "cloudflare-rest",
  "mailgun",
  "postmark",
  "brevo",
  "mailersend",
  "mailjet",
  "smtp2go",
  "zeptomail",
  "sendgrid",
  "ses",
  "smtp",
] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDER_IDS)[number];

/** The provider that a fresh Settings form selects. */
export const DEFAULT_EMAIL_PROVIDER_ID: EmailProviderId = "tosend";

/** What an adapter factory can get from the Worker. */
export interface AdapterDeps {
  /** `connect` from `cloudflare:sockets`, for SMTP. Tests pass a fake. */
  connect?: SocketConnect;
}

export type AdapterFactory = (deps: AdapterDeps) => ProviderAdapter;

/**
 * The SES adapter keeps an SNS certificate cache. One adapter per isolate lets that cache
 * live between webhook requests.
 */
let sesAdapter: ProviderAdapter | undefined;

/**
 * Catalog ID to adapter factory. Credentials come from the send context, so no factory
 * takes keys. A new catalog provider needs one entry here and in `EMAIL_PROVIDER_IDS`.
 */
export const ADAPTER_FACTORIES: Readonly<Record<EmailProviderId, AdapterFactory>> = {
  resend: () => resend(),
  tosend: () => tosend(),
  "cloudflare-rest": () => cloudflareRest(),
  mailgun: () => mailgun(),
  postmark: () => postmark(),
  brevo: () => brevo(),
  mailersend: () => mailersend(),
  mailjet: () => mailjet(),
  smtp2go: () => smtp2go(),
  zeptomail: () => zeptomail(),
  sendgrid: () => sendgrid(),
  ses: () => {
    sesAdapter ??= ses();
    return sesAdapter;
  },
  smtp: ({ connect }) => smtp({ connect }),
};

/**
 * Default daily caps by provider ID, for the plan the Owner most likely has. A preset
 * cap (for example SMTP Gmail, 500) takes precedence. mailswitch 0.2.0 has caps only on
 * presets, so the app keeps this table.
 */
export const DEFAULT_DAILY_CAPS: Readonly<Partial<Record<EmailProviderId, number>>> = {
  // The Resend free plan allows 100 emails a day.
  resend: 100,
};

export function isEmailProviderId(id: string): id is EmailProviderId {
  return (EMAIL_PROVIDER_IDS as readonly string[]).includes(id);
}

/** The catalog meta of a provider the Owner can pick, or undefined. */
export function emailProviderMeta(id: string): ProviderMeta | undefined {
  return isEmailProviderId(id) ? getProviderMeta(id) : undefined;
}

/** The catalog meta of every provider the Owner can pick, in catalog order. */
export function emailProviderCatalog(): ProviderMeta[] {
  return EMAIL_PROVIDER_IDS.map((id) => {
    const meta = getProviderMeta(id);
    if (!meta) throw new Error(`mailswitch has no provider "${id}"`);
    return meta;
  });
}

export function createAdapter(id: EmailProviderId, deps: AdapterDeps = {}): ProviderAdapter {
  return ADAPTER_FACTORIES[id](deps);
}

/** The daily cap that applies when the Owner sets none: the preset cap, then the table. */
export function defaultDailyCap(id: string, presetId?: string | null): number | null {
  const preset = presetId ? emailProviderMeta(id)?.presets?.find((p) => p.id === presetId) : null;
  if (preset?.defaultDailyCap !== undefined) return preset.defaultDailyCap;
  return isEmailProviderId(id) ? (DEFAULT_DAILY_CAPS[id] ?? null) : null;
}
