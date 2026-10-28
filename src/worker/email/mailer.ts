// The app mailer: one mailswitch mailer per send, built from the stored primary and
// fallback providers. This is the only module that imports `cloudflare:sockets`.
import { connect } from "cloudflare:sockets";
import { createMailer, type Mailer, type ProviderAdapter, type SocketConnect } from "mailswitch";
import { D1DailyCapStore, D1IdempotencyStore } from "mailswitch/stores/d1";
import type { EmailProviderRole } from "../../shared/domain";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import { AppError } from "../errors";
import { FAKE_EMAIL_CREDENTIALS, fakeExternals } from "../externals";
import { createAdapter, parseHttpAllowHosts } from "./catalog";
import { type ReadyEmailProvider, usableEmailProviders } from "./settings";

/**
 * The idempotency namespace. mailswitch stores each key as `plainbooks:<key>`. Never change
 * it: a new value frees every key, so a retried job could send a second copy.
 */
export const MAILER_NAMESPACE = "plainbooks";

/** The adapter, credentials, and preset of one mailer entry. */
export interface MailerEntry {
  adapter: ProviderAdapter;
  credentials: Readonly<Record<string, unknown>>;
  preset?: string;
}

/** Turns a stored provider into a mailer entry. Tests and FAKE_EXTERNALS swap it. */
export type MailerEntryFactory = (provider: ReadyEmailProvider) => MailerEntry;

let testEntries: MailerEntryFactory | null = null;

/** Tests only: replaces the adapters of the stored providers. Pass null to restore them. */
export function setMailerEntriesForTesting(factory: MailerEntryFactory | null): void {
  testEntries = factory;
}

/** `connect` of `cloudflare:sockets` in the shape that the SMTP adapter calls. */
const socketConnect: SocketConnect = (target) =>
  connect(
    { hostname: target.hostname, port: target.port },
    { secureTransport: target.secureTransport, allowHalfOpen: false },
  );

function entryFactory(env: Bindings): MailerEntryFactory {
  if (testEntries) return testEntries;
  const fakes = fakeExternals(env);
  if (fakes) {
    return (provider) => ({
      adapter: fakes.emailAdapter(provider.providerId),
      credentials: FAKE_EMAIL_CREDENTIALS,
    });
  }
  const httpAllowHosts = parseHttpAllowHosts(env.EMAIL_HTTP_ALLOW_HOSTS);
  return (provider) => ({
    adapter: createAdapter(provider.providerId, {
      connect: socketConnect,
      config: provider.config,
      httpAllowHosts,
    }),
    credentials: provider.credentials,
    preset: provider.presetId ?? undefined,
  });
}

/**
 * The adapter and credentials of one stored or candidate provider. Settings uses it for
 * `verify()` and test sends, so tests and FAKE_EXTERNALS swap the same adapters as sends.
 */
export function mailerEntry(env: Bindings, provider: ReadyEmailProvider): MailerEntry {
  return entryFactory(env)(provider);
}

/** `connect` for direct adapter calls, such as an SMTP `verify()` in Settings. */
export const smtpConnect: SocketConnect = socketConnect;

/** The primary that FAKE_EXTERNALS uses when no provider is saved, so local sends work. */
const FAKE_PRIMARY: ReadyEmailProvider = {
  role: "primary",
  providerId: "tosend",
  presetId: null,
  dailyCap: null,
  defaultDailyCap: null,
  config: {},
  updatedAt: 0,
  status: "ready",
  credentials: FAKE_EMAIL_CREDENTIALS,
  webhookSecret: null,
};

/**
 * The providers a send uses, primary first. Throws 422 `email_not_configured` when no
 * primary is saved or its keys need re-entry.
 */
export async function mailProviders(env: Bindings, db: Db): Promise<ReadyEmailProvider[]> {
  try {
    return await usableEmailProviders(db, env.ENCRYPTION_KEY);
  } catch (err) {
    const unset = err instanceof AppError && err.code === "email_not_configured";
    if (unset && fakeExternals(env)) return [FAKE_PRIMARY];
    throw err;
  }
}

/** The cap that applies to a provider: the Owner's value, then the default. Null is no cap. */
export function dailyCapOf(provider: ReadyEmailProvider): number | null {
  return provider.dailyCap ?? provider.defaultDailyCap;
}

/**
 * The cap counter name of a provider: `<provider-id>:<role>`. Two accounts of one provider
 * as primary and fallback then keep separate counters.
 */
export function capScope(provider: { providerId: string; role: EmailProviderRole }): string {
  return `${provider.providerId}:${provider.role}`;
}

/**
 * Builds the mailer for one send. The stores use the D1 binding under `db`, so the
 * scheduler counts their statements. The clock starts at `now`, so tests can fix it.
 * Throws 422 `email_not_configured` when mailswitch refuses the stored settings.
 */
export function createAppMailer(
  env: Bindings,
  db: Db,
  providers: readonly ReadyEmailProvider[],
  now: number,
): Mailer {
  const d1 = db.$client;
  const toEntry = entryFactory(env);
  const started = Date.now();
  try {
    return createMailer({
      providers: providers.map((provider) => {
        const cap = dailyCapOf(provider);
        return {
          ...toEntry(provider),
          scope: capScope(provider),
          ...(cap === null ? {} : { dailyCap: cap }),
        };
      }),
      namespace: MAILER_NAMESPACE,
      idempotency: new D1IdempotencyStore(d1),
      dailyCaps: new D1DailyCapStore(d1),
      connect: socketConnect,
      logger: { warn: (message, data) => console.warn(message, JSON.stringify(data ?? {})) },
      now: () => now + (Date.now() - started),
    });
  } catch (err) {
    // A TypeError or RangeError names the refused option, never a key value.
    if (err instanceof TypeError || err instanceof RangeError) {
      console.error("email provider settings refused", err.message);
      throw new AppError(
        422,
        "email_not_configured",
        "Enter the email provider keys again in Settings",
      );
    }
    throw err;
  }
}

/** The daily cap use of the capped providers. */
export interface EmailCapacity {
  /** Sends in the rolling 24 hours, summed over the providers that have a cap. */
  used: number;
  /** The summed caps, or null when a provider has no cap. */
  limit: number | null;
  /** True when every provider is at its cap, so a send cannot go out now. */
  full: boolean;
  /**
   * The providers with room, primary first. A send uses only these, so a provider known
   * to be at its cap costs no cap reservation and no heartbeat.
   */
  available: ReadyEmailProvider[];
}

/**
 * Reads the cap counters through `D1DailyCapStore`: one statement per capped provider.
 * A provider with no cap is never full. Without `totals`, the read stops at the first
 * provider with room, and the later providers stay in `available` unchecked: the mailer
 * still enforces their caps. That keeps a send inside the D1 query budget.
 */
export async function emailCapacity(
  db: Db,
  providers: readonly ReadyEmailProvider[],
  now: number,
  options: { totals?: boolean } = {},
): Promise<EmailCapacity> {
  const store = new D1DailyCapStore(db.$client);
  let used = 0;
  let limit: number | null = 0;
  const available: ReadyEmailProvider[] = [];
  for (const provider of providers) {
    const cap = dailyCapOf(provider);
    if (cap === null || (available.length > 0 && !options.totals)) {
      if (cap === null) limit = null;
      else if (limit !== null) limit += cap;
      available.push(provider);
      continue;
    }
    const count = await store.used(capScope(provider), now);
    used += count;
    if (limit !== null) limit += cap;
    if (count < cap) available.push(provider);
  }
  return { used, limit, full: available.length === 0, available };
}
