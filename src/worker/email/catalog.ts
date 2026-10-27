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
import type { EmailProviderOption, WebhookSecretField } from "../../shared/schemas/email-settings";

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

/**
 * How Settings asks for the webhook secret of each provider with webhooks. mailswitch
 * 0.2.0 meta has `webhooks: true` but no field description, so the app keeps these labels.
 * A provider with webhooks and no entry here gets the generic label. A hint asks the Owner
 * to select only the events that the app records, so a batch of events stays under the
 * D1 query limit of one request.
 */
export const WEBHOOK_SECRET_FIELDS: Readonly<Partial<Record<EmailProviderId, WebhookSecretField>>> =
  {
    resend: {
      label: "Signing secret",
      hint: "Copy it from the webhook in Resend. It starts with whsec_.",
      placeholder: "whsec_...",
    },
    tosend: {
      label: "Webhook signing secret",
      hint: "Copy it from the webhook in toSend.",
    },
    mailgun: {
      label: "HTTP webhook signing key",
      hint: "Copy it from the Webhooks page in Mailgun.",
    },
    postmark: {
      label: "Webhook password",
      hint: "Make a random value of at least 22 characters. In Postmark, set the webhook Basic auth username to mailswitch and the password to this value.",
    },
    brevo: {
      label: "Webhook token",
      hint: "Make a random value of at least 22 characters. Give it to Brevo as the bearer token of the webhook. Select only the hard bounce, soft bounce, invalid email, and spam events.",
    },
    mailersend: {
      label: "Signing secret",
      hint: "Copy it from the webhook in MailerSend. Select only the activity.hard_bounced, activity.soft_bounced, and activity.spam_complaint events.",
    },
    mailjet: {
      label: "Webhook password",
      hint: "Make a random value of at least 22 characters. Put it in the webhook URL that you give Mailjet as the Basic auth password. Add the URL only for the bounce and spam events, and turn off event grouping.",
    },
    smtp2go: {
      label: "Webhook secret",
      hint: "Make a random value of at least 22 characters. Give it to SMTP2GO as the bearer token of the webhook. Select only the bounce and spam events.",
    },
    sendgrid: {
      label: "Verification key",
      hint: "The public key of the signed Event Webhook in SendGrid. Select only the bounced and spam report events.",
    },
    ses: {
      label: "SNS topic ARNs",
      hint: "The ARNs of the SNS topics that send SES events, separated by commas. Other topics are refused. Send only the bounce and complaint events to these topics.",
      placeholder: "arn:aws:sns:us-east-1:123456789012:ses-events",
    },
  };

const GENERIC_WEBHOOK_SECRET: WebhookSecretField = {
  label: "Webhook secret",
  hint: "The secret that signs the webhook requests of this provider.",
};

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
      webhookSecret: meta.webhooks ? (WEBHOOK_SECRET_FIELDS[id] ?? GENERIC_WEBHOOK_SECRET) : null,
      defaultDailyCap: DEFAULT_DAILY_CAPS[id] ?? null,
    };
  });
}
