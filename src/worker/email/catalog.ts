import type { ProviderAdapter, ProviderMeta, SocketConnect } from "mailswitch";
import { ahasend } from "mailswitch/ahasend";
import { autosend } from "mailswitch/autosend";
import { brevo } from "mailswitch/brevo";
import { getProviderMeta, isProviderId, PROVIDER_IDS, type ProviderId } from "mailswitch/catalog";
import { cloudflareRest } from "mailswitch/cloudflare";
import { mailersend } from "mailswitch/mailersend";
import { mailgun } from "mailswitch/mailgun";
import { mailjet } from "mailswitch/mailjet";
import { mailtrap } from "mailswitch/mailtrap";
import { postmark } from "mailswitch/postmark";
import { resend } from "mailswitch/resend";
import { scaleway } from "mailswitch/scaleway";
import { sendgrid } from "mailswitch/sendgrid";
import { ses } from "mailswitch/ses";
import { smtp } from "mailswitch/smtp";
import { smtp2go } from "mailswitch/smtp2go";
import { tosend } from "mailswitch/tosend";
import { zeptomail } from "mailswitch/zeptomail";
import type { EmailProviderOption, WebhookSecretField } from "../../shared/schemas/email-settings";

/**
 * The catalog providers that Settings does not offer:
 * - `cloudflare-binding`: the deploy declares no `send_email` binding.
 * - `mailchannels`: its webhooks need the `customerHandle` adapter option, which the app
 *   does not store yet.
 * - `http`: it needs a JSON config with `allowHosts`, which the app does not store yet.
 */
const UNOFFERED_PROVIDER_IDS = ["cloudflare-binding", "mailchannels", "http"] as const;

export type EmailProviderId = Exclude<ProviderId, (typeof UNOFFERED_PROVIDER_IDS)[number]>;

function isOffered(id: ProviderId): id is EmailProviderId {
  return !(UNOFFERED_PROVIDER_IDS as readonly string[]).includes(id);
}

/** The providers the Owner can pick in Settings, in the mailswitch catalog order. */
export const EMAIL_PROVIDER_IDS: readonly EmailProviderId[] = PROVIDER_IDS.filter(isOffered);

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
 * takes keys. A new catalog provider needs one entry here, or an entry in
 * `UNOFFERED_PROVIDER_IDS`.
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
  ahasend: () => ahasend(),
  mailtrap: () => mailtrap(),
  autosend: () => autosend(),
  scaleway: () => scaleway(),
};

/**
 * Default daily caps by provider ID, for the plan the Owner most likely has. A preset
 * cap (for example SMTP Gmail, 500) takes precedence. The built-in mailswitch meta sets
 * no `defaultDailyCap`, so the app keeps this table.
 */
export const DEFAULT_DAILY_CAPS: Readonly<Partial<Record<EmailProviderId, number>>> = {
  // The Resend free plan allows 100 emails a day.
  resend: 100,
};

export function isEmailProviderId(id: string): id is EmailProviderId {
  return isProviderId(id) && isOffered(id);
}

/** The catalog meta of a provider the Owner can pick, or undefined. */
export function emailProviderMeta(id: string): ProviderMeta | undefined {
  return isEmailProviderId(id) ? getProviderMeta(id) : undefined;
}

/** The catalog meta of every provider the Owner can pick, in catalog order. */
export function emailProviderCatalog(): ProviderMeta[] {
  return EMAIL_PROVIDER_IDS.map((id) => getProviderMeta(id));
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

/**
 * The hints that Settings shows for the webhook secret, where the app needs other text
 * than the mailswitch meta. The meta hints name the mailswitch generate helpers, which
 * the Owner cannot run. A hint here also asks the Owner to select only the events that
 * the app records, so a batch of events stays under the D1 query limit of one request.
 * A provider with no entry gets the meta hint. The label and placeholder always come
 * from the meta.
 */
export const WEBHOOK_SECRET_HINTS: Readonly<Partial<Record<EmailProviderId, string>>> = {
  resend: "Copy it from the webhook in Resend. It starts with whsec_.",
  tosend: "Copy it from the webhook in toSend.",
  mailgun: "Copy it from the Webhooks page in Mailgun.",
  postmark:
    "Make a random value of at least 22 characters. In Postmark, set the webhook Basic auth username to mailswitch and the password to this value.",
  brevo:
    "Make a random value of at least 22 characters. Give it to Brevo as the bearer token of the webhook. Select only the hard bounce, soft bounce, invalid email, and spam events.",
  mailersend:
    "Copy it from the webhook in MailerSend. Select only the activity.hard_bounced, activity.soft_bounced, and activity.spam_complaint events.",
  mailjet:
    "Make a random value of at least 22 characters. Put it in the webhook URL that you give Mailjet as the Basic auth password. Add the URL only for the bounce and spam events, and turn off event grouping.",
  smtp2go:
    "Make a random value of at least 22 characters. Give it to SMTP2GO as the bearer token of the webhook. Select only the bounce and spam events.",
  sendgrid:
    "The public key of the signed Event Webhook in SendGrid. Select only the bounced and spam report events.",
  ses: "The ARNs of the SNS topics that send SES events, separated by commas. Other topics are refused. Send only the bounce and complaint events to these topics.",
};

function webhookSecretField(meta: ProviderMeta, id: EmailProviderId): WebhookSecretField | null {
  const secret = meta.webhookSecret;
  if (!meta.webhooks || !secret) return null;
  return {
    label: secret.label,
    hint: WEBHOOK_SECRET_HINTS[id] ?? secret.hint ?? "",
    ...(secret.placeholder === undefined ? {} : { placeholder: secret.placeholder }),
  };
}

/** The provider list that Settings shows, from the catalog plus the app's own tables. */
export function emailProviderOptions(): EmailProviderOption[] {
  return emailProviderCatalog().map((meta) => {
    const id = meta.id as EmailProviderId;
    return {
      id,
      name: meta.name,
      docsUrl: meta.docsUrl,
      credentialFields: meta.credentialFields.map((field) => ({ ...field })),
      presets: (meta.presets ?? []).map((preset) => ({ ...preset })),
      webhookSecret: webhookSecretField(meta, id),
      defaultDailyCap: DEFAULT_DAILY_CAPS[id] ?? null,
    };
  });
}
