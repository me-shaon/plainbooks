import { env } from "cloudflare:workers";
import type { OutgoingMessage } from "mailswitch";
import { type FakeOutcome, type FakeProvider, fakeProvider } from "mailswitch/testing";
import type { EmailProviderRole } from "../../src/shared/domain";
import { createDb } from "../../src/worker/db/client";
import { capScope, setMailerEntriesForTesting } from "../../src/worker/email/mailer";
import { saveEmailProvider } from "../../src/worker/email/settings";

/** Keys that pass the catalog field rules, by provider ID. */
const STORED_CREDENTIALS: Record<string, Record<string, string>> = {
  tosend: { apiKey: "tsend_test_key" },
  resend: { apiKey: "re_test_key" },
};

/** The keys the fake adapter accepts. The stored keys never reach it. */
const FAKE_CREDENTIALS = { apiKey: "fk_test" };

export interface FakeRoleOptions {
  /** The catalog provider ID to save. Defaults to `tosend`. */
  providerId?: string;
  /** The fake outcomes, in call order. A call past the list is `sent`. */
  outcomes?: readonly FakeOutcome[] | ((message: OutgoingMessage, call: number) => FakeOutcome);
  /** The daily cap to save. Null or undefined is the default cap. */
  dailyCap?: number | null;
}

export interface FakeEmail {
  primary: FakeProvider;
  fallback: FakeProvider | null;
  /** The messages the primary got, in order. */
  messages(): OutgoingMessage[];
}

/**
 * Saves a primary (and an optional fallback) in email_providers and swaps their adapters
 * for `mailswitch/testing` fakes. Each fake has the ID of its stored provider, so cap
 * scopes and logged provider names match production.
 */
export async function useFakeEmail(
  options: { primary?: FakeRoleOptions; fallback?: FakeRoleOptions } = {},
): Promise<FakeEmail> {
  const db = createDb(env.DB);
  const fakes: Partial<Record<EmailProviderRole, FakeProvider>> = {};
  for (const role of ["primary", "fallback"] as const) {
    const setup = role === "primary" ? (options.primary ?? {}) : options.fallback;
    if (!setup) continue;
    const providerId = setup.providerId ?? "tosend";
    await saveEmailProvider(db, env.ENCRYPTION_KEY, role, {
      providerId,
      credentials: STORED_CREDENTIALS[providerId] ?? {},
      dailyCap: setup.dailyCap ?? null,
    });
    fakes[role] = fakeProvider({ id: providerId, outcomes: setup.outcomes });
  }
  setMailerEntriesForTesting((provider) => {
    const adapter = fakes[provider.role];
    if (!adapter) throw new Error(`No fake for the ${provider.role} provider`);
    return { adapter, credentials: FAKE_CREDENTIALS };
  });
  const primary = fakes.primary as FakeProvider;
  return {
    primary,
    fallback: fakes.fallback ?? null,
    messages: () => primary.sends.map((send) => send.message),
  };
}

/** Restores the real adapters. Call it in afterEach after `useFakeEmail`. */
export function restoreEmail(): void {
  setMailerEntriesForTesting(null);
}

/**
 * Clears email, job, notification, provider, and mailswitch rows, and sets the sender
 * address. It saves no provider: call `useFakeEmail` for that.
 */
export async function resetEmailState(): Promise<void> {
  setMailerEntriesForTesting(null);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_log"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM notifications"),
    env.DB.prepare("DELETE FROM email_providers"),
    env.DB.prepare("DELETE FROM mailswitch_idempotency"),
    env.DB.prepare("DELETE FROM mailswitch_daily_cap"),
    env.DB.prepare("DELETE FROM mailswitch_webhook_dedupe"),
    env.DB.prepare(
      "UPDATE workspace SET email_from_address = 'billing@studio.test', email_from_name = 'Studio One', reply_to_email = 'hello@studio.test'",
    ),
  ]);
}

/** Puts `count` sends in the cap counter of a stored provider, in the bucket of `now`. */
export async function fillDailyCap(
  provider: { providerId: string; role: EmailProviderRole },
  count: number,
  now: number,
): Promise<void> {
  const bucketStart = Math.floor(now / 300_000) * 300_000;
  await env.DB.prepare(
    `INSERT INTO mailswitch_daily_cap (scope, bucket_start, used) VALUES (?, ?, ?)
     ON CONFLICT(scope, bucket_start) DO UPDATE SET used = used + excluded.used`,
  )
    .bind(capScope(provider), bucketStart, count)
    .run();
}

/** The cap counter of a stored provider at `now`. */
export async function dailyCapUsed(
  provider: { providerId: string; role: EmailProviderRole },
  now: number,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(used), 0) AS used FROM mailswitch_daily_cap WHERE scope = ? AND bucket_start > ?",
  )
    .bind(capScope(provider), now - 86_400_000 - 300_000)
    .first<{ used: number }>();
  return row?.used ?? 0;
}
