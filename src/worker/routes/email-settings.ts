import { Hono } from "hono";
import {
  createSendContext,
  type ProviderAdapter,
  type SendContext,
  sendTestEmail,
  type VerifyResult,
} from "mailswitch";
import { EMAIL_PROVIDER_ROLES, type EmailProviderRole } from "../../shared/domain";
import {
  type EmailSettings,
  emailProviderInput,
  type TestEmailResult,
  testEmailInput,
} from "../../shared/schemas/email-settings";
import { requireOwner } from "../auth/middleware";
import type { Db } from "../db/client";
import {
  DEFAULT_EMAIL_PROVIDER_ID,
  emailProviderOptions,
  parseHttpAllowHosts,
} from "../email/catalog";
import { mailerEntry, mailProviders, smtpConnect } from "../email/mailer";
import {
  type CheckedEmailProvider,
  deleteEmailProvider,
  getEmailSettingsView,
  loadEmailProviders,
  type ReadyEmailProvider,
  type StoredEmailProviders,
  saveEmailProvider,
} from "../email/settings";
import type { AppEnv, Bindings } from "../env";
import { AppError, parseJson } from "../errors";
import { appOrigin, senderAddress } from "../services/email";
import { loadWorkspace } from "../services/settings";

/** The longest time a credential check or a test send may take. */
export const VERIFY_TIMEOUT_MS = 10_000;

/** What the Owner reads when `verify()` refuses the keys, by mailswitch reason. */
const VERIFY_REASON_TEXT: Partial<Record<string, string>> = {
  auth: "The provider refused the keys. Check them and try again.",
  rate_limited: "The provider limited the requests. Wait a minute and try again.",
  quota: "The provider account has no sending quota left.",
  credits: "The provider account has no credits left.",
  rejected: "The provider refused the request. Check the account and the keys.",
  timeout: "The provider did not answer in 10 seconds. Try again.",
  network: "The provider could not be reached. Try again.",
  provider_error: "The provider had an error. Try again later.",
};

/** The webhook URL of a role, `<origin>/api/webhooks/email/<role>`. */
export function webhookUrl(env: Pick<Bindings, "APP_URL">, origin: string, role: string): string {
  return `${appOrigin(env) || origin}/api/webhooks/email/${role}`;
}

/** Races `run` against the timeout. A throw or a timeout gives a failed result. */
async function withTimeout<T>(run: () => Promise<T>, onFailure: (timedOut: boolean) => T) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onFailure(true)), VERIFY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run().catch(() => onFailure(false)), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function failure(timedOut: boolean) {
  return {
    ok: false as const,
    status: "unknown" as const,
    reason: timedOut ? ("timeout" as const) : ("provider_error" as const),
    message: timedOut ? "The provider did not answer in time" : "The provider check failed",
  };
}

/**
 * The adapter and a send context with a 10 s timeout, for one direct adapter call.
 * Throws 422 `email_not_configured` when the saved config no longer builds an adapter,
 * for example after `EMAIL_HTTP_ALLOW_HOSTS` lost a host.
 */
function directCall(
  env: Bindings,
  provider: ReadyEmailProvider,
): { adapter: ProviderAdapter; ctx: SendContext } {
  let entry: ReturnType<typeof mailerEntry>;
  try {
    entry = mailerEntry(env, provider);
  } catch (err) {
    // The mailswitch TypeError names the refused option, never a key value.
    if (!(err instanceof TypeError)) throw err;
    console.error("email provider config refused", err.message);
    throw new AppError(422, "email_not_configured", "Check the email provider config in Settings");
  }
  const ctx = createSendContext({
    credentials: entry.credentials as Readonly<Record<string, string>>,
    timeoutMs: VERIFY_TIMEOUT_MS,
    connect: smtpConnect,
  });
  return { adapter: entry.adapter, ctx };
}

function sameRecord(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * The checks before a save: a fallback needs a primary, the two roles cannot hold the same
 * account, and `verify()` must accept the keys.
 */
function saveCheck(env: Bindings) {
  return async (candidate: CheckedEmailProvider, stored: StoredEmailProviders) => {
    if (candidate.role === "fallback" && !stored.primary) {
      throw new AppError(409, "primary_required", "Save a primary provider before a fallback");
    }
    const other = stored[candidate.role === "primary" ? "fallback" : "primary"];
    if (
      other?.status === "ready" &&
      other.providerId === candidate.providerId &&
      sameRecord(other.credentials, candidate.credentials)
    ) {
      throw new AppError(
        409,
        "same_email_account",
        "The fallback must be a different provider or account than the primary",
      );
    }
    const provider: ReadyEmailProvider = {
      ...candidate,
      defaultDailyCap: null,
      updatedAt: Date.now(),
      status: "ready",
      webhookSecret: null,
    };
    const { adapter, ctx } = directCall(env, provider);
    const result: VerifyResult = await withTimeout(() => adapter.verify(ctx), failure);
    if (!result.ok) {
      throw new AppError(
        422,
        "email_verify_failed",
        VERIFY_REASON_TEXT[result.reason] ?? `The provider check failed: ${result.message}`,
        [{ path: "verify", message: result.reason }],
      );
    }
  };
}

async function settingsBody(env: Bindings, db: Db, origin: string): Promise<EmailSettings> {
  const webhookUrls = {} as EmailSettings["webhookUrls"];
  for (const role of EMAIL_PROVIDER_ROLES) webhookUrls[role] = webhookUrl(env, origin, role);
  return {
    providers: emailProviderOptions(),
    defaultProviderId: DEFAULT_EMAIL_PROVIDER_ID,
    settings: await getEmailSettingsView(db, env.ENCRYPTION_KEY),
    webhookUrls,
  };
}

/** The provider of a role for a test send. Throws 422 when the role cannot send. */
async function testProvider(
  env: Bindings,
  db: Db,
  role: EmailProviderRole,
): Promise<ReadyEmailProvider> {
  if (role === "primary") {
    const [primary] = await mailProviders(env, db);
    if (primary) return primary;
  } else {
    const { fallback } = await loadEmailProviders(db, env.ENCRYPTION_KEY);
    if (fallback?.status === "ready") return fallback;
  }
  throw new AppError(422, "email_not_configured", `Set up the ${role} email provider first`);
}

/**
 * Email provider settings, mounted at /api/settings/email. Owner only. GET returns the
 * provider list and the masked settings. No response ever holds a saved key.
 */
export const emailSettingsRoutes = new Hono<AppEnv>()
  .use(requireOwner)
  .get("/", async (c) => c.json(await settingsBody(c.env, c.var.db, new URL(c.req.url).origin)))
  /** Checks the keys with `verify()`, then saves them encrypted. */
  .put("/:role{primary|fallback}", async (c) => {
    const role = c.req.param("role") as EmailProviderRole;
    const input = await parseJson(c, emailProviderInput);
    const view = await saveEmailProvider(c.var.db, c.env.ENCRYPTION_KEY, role, input, {
      check: saveCheck(c.env),
      httpAllowHosts: parseHttpAllowHosts(c.env.EMAIL_HTTP_ALLOW_HOSTS),
    });
    return c.json(view);
  })
  .delete("/fallback", async (c) => {
    await deleteEmailProvider(c.var.db, "fallback");
    return c.body(null, 204);
  })
  /** Sends one test email to the Owner who asks, through the primary or the fallback. */
  .post("/test", async (c) => {
    const { role = "primary" } = await parseJson(c, testEmailInput);
    const from = senderAddress(await loadWorkspace(c.var.db));
    const provider = await testProvider(c.env, c.var.db, role);
    const to = c.var.user.email;
    const { adapter, ctx } = directCall(c.env, provider);
    const result = await withTimeout(
      () =>
        sendTestEmail(adapter, ctx, {
          from,
          to,
          subject: "PlainBooks test email",
          text: "This is a test email from PlainBooks. Your email provider settings work.",
        }),
      (timedOut) => ({ ...failure(timedOut), message: "The test send did not finish" }),
    );
    const body: TestEmailResult =
      result.status === "sent"
        ? { status: "sent", to }
        : { status: result.status, to, reason: result.reason, message: result.message };
    return c.json(body);
  });
