import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../env";
import { RateLimitedError } from "../errors";
import { sha256Hex } from "./crypto";

// Attempt counters for sign-in, password reset, setup, recovery, and token links. One
// Durable Object instance holds one counter, for example `sign-in:ip:198.51.100.7`. A
// Durable Object runs its code one event at a time, and `consume` reads and writes its
// SQLite row with no await between, so a check and its count are one atomic step across
// all Worker isolates. better-auth's own limiter is off (auth.ts).

export interface RateRule {
  /** Attempts allowed in one window. The next attempt is refused. */
  limit: number;
  windowMs: number;
}

export interface RateResult {
  allowed: boolean;
  /** Attempts counted in the current window. */
  count: number;
  /** Milliseconds until the window ends, or 0 when allowed. */
  retryAfterMs: number;
}

/** One counter to consume: the Durable Object name and its rule. */
export interface RateCheck {
  key: string;
  rule: RateRule;
}

interface AttemptRow extends Record<string, SqlStorageValue> {
  start: number;
  count: number;
  window_ms: number;
}

/**
 * A fixed-window counter in Durable Object SQLite storage. Methods are called through
 * Workers RPC. An alarm deletes the row after the window ends, so idle keys cost nothing.
 */
export class AuthRateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        window_ms INTEGER NOT NULL
      )`,
    );
  }

  /**
   * Counts one attempt when the window has room, and returns the new status. A refused
   * attempt is not counted, so the window still ends at its first attempt plus `windowMs`.
   */
  async consume(rule: RateRule, now = Date.now()): Promise<RateResult> {
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<AttemptRow>("SELECT start, count, window_ms FROM attempts WHERE id = 1")
      .toArray()[0];
    const fresh = !row || now - row.start >= rule.windowMs;
    const start = fresh ? now : row.start;
    const count = fresh ? 0 : row.count;
    if (count >= rule.limit) {
      return { allowed: false, count, retryAfterMs: Math.max(0, start + rule.windowMs - now) };
    }
    sql.exec(
      `INSERT INTO attempts (id, start, count, window_ms) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET start = excluded.start, count = excluded.count,
         window_ms = excluded.window_ms`,
      start,
      count + 1,
      rule.windowMs,
    );
    // The row is written before this first await, so a parallel call sees the new count.
    if (fresh) await this.ctx.storage.setAlarm(start + rule.windowMs);
    return { allowed: true, count: count + 1, retryAfterMs: 0 };
  }

  /**
   * Returns the status without counting an attempt. `allowed` is false when the window is
   * already full. Password sign-in peeks first and consumes only after a failure.
   */
  async peek(rule: RateRule, now = Date.now()): Promise<RateResult> {
    const row = this.ctx.storage.sql
      .exec<AttemptRow>("SELECT start, count, window_ms FROM attempts WHERE id = 1")
      .toArray()[0];
    if (!row || now - row.start >= rule.windowMs) {
      return { allowed: true, count: 0, retryAfterMs: 0 };
    }
    if (row.count >= rule.limit) {
      return {
        allowed: false,
        count: row.count,
        retryAfterMs: Math.max(0, row.start + rule.windowMs - now),
      };
    }
    return { allowed: true, count: row.count, retryAfterMs: 0 };
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<AttemptRow>("SELECT start, count, window_ms FROM attempts WHERE id = 1")
      .toArray()[0];
    if (row && now - row.start < row.window_ms) {
      await this.ctx.storage.setAlarm(row.start + row.window_ms);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}

// ---------------------------------------------------------------------------
// Rules and keys
// ---------------------------------------------------------------------------

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/**
 * The rules. Every attempt counts, except password sign-in, where only failed attempts
 * count. Per email, the counter key holds the SHA-256 of the lowercase email, so no
 * Durable Object name holds an address.
 */
export const RATE_RULES = {
  /** Failed password sign-ins from one IP. */
  signInIp: { limit: 5, windowMs: FIFTEEN_MINUTES },
  /** Failed password sign-ins for one email, from all IPs. */
  signInEmail: { limit: 20, windowMs: FIFTEEN_MINUTES },
  /** Password reset requests and reset-link use from one IP. */
  passwordResetIp: { limit: 5, windowMs: FIFTEEN_MINUTES },
  /** Password reset requests for one email, from all IPs. */
  passwordResetEmail: { limit: 20, windowMs: FIFTEEN_MINUTES },
  /**
   * Reset emails sent to one address. A request past the limit gets the same answer and
   * sends nothing, so anonymous requests cannot use up the provider's daily cap.
   */
  passwordResetMail: { limit: 2, windowMs: ONE_HOUR },
  /** Setup and recovery attempts from one IP. */
  setupIp: { limit: 5, windowMs: FIFTEEN_MINUTES },
  /** Setup and recovery attempts over the whole deployment. */
  setupGlobal: { limit: 20, windowMs: FIFTEEN_MINUTES },
  /** Invite and Owner-reset link use from one IP. */
  tokenLinkIp: { limit: 5, windowMs: FIFTEEN_MINUTES },
  /** Invite page loads from one IP. A lookup reads a link and does not use it. */
  tokenLookupIp: { limit: 30, windowMs: FIFTEEN_MINUTES },
} as const satisfies Record<string, RateRule>;

/** The action part of a counter key. */
export type RateAction =
  | "sign-in"
  | "password-reset"
  | "password-reset-mail"
  | "setup"
  | "token-link"
  | "token-lookup";

/** The eight 16-bit groups of an IPv6 address, or null when it is not valid IPv6. */
function ipv6Groups(ip: string): string[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
}

/**
 * The client part of an IP counter key. One IPv6 client often holds a whole /64, so an
 * IPv6 address becomes its /64 prefix, for example `2001:db8:0:1::/64`. An IPv4 address
 * and an IPv4-mapped IPv6 address stay one address.
 */
export function ipKeyPart(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!ip.includes(":")) return ip;
  const groups = ipv6Groups(ip.split("%")[0] ?? ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip;
}

/** Counter keys. */
export const rateKeys = {
  ip: (action: RateAction, ip: string) => `${action}:ip:${ipKeyPart(ip)}`,
  email: async (action: RateAction, email: string) =>
    `${action}:email:${await sha256Hex(email.trim().toLowerCase())}`,
  /** One counter for the whole deployment, for setup and recovery. */
  global: (action: RateAction) => `${action}:global`,
};

/** The client IP. Cloudflare sets `CF-Connecting-IP` on every request. */
export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

// ---------------------------------------------------------------------------
// Consume
// ---------------------------------------------------------------------------

/** "consume" counts an attempt when the window has room. "peek" only reads the status. */
export type RateMode = "consume" | "peek";

/** Consumes or peeks at one counter. Tests can replace it. */
export type RateBackend = (env: Bindings, check: RateCheck, mode: RateMode) => Promise<RateResult>;

const durableBackend: RateBackend = (env, check, mode) => {
  const stub = env.AUTH_RATE_LIMITER.getByName(check.key);
  return mode === "peek" ? stub.peek(check.rule) : stub.consume(check.rule);
};

let backendOverride: RateBackend | null = null;

/** Replaces the Durable Object calls in tests. Pass null to restore them. */
export function setRateBackendForTesting(backend: RateBackend | null): void {
  backendOverride = backend;
}

export interface ConsumeOptions {
  /**
   * What to do when a counter call fails. "open" allows the attempt and logs an error.
   * "closed" throws. Password sign-in fails open. Setup and recovery fail closed.
   */
  onError: "open" | "closed";
}

/**
 * Consumes the counters in order and stops at the first refusal, so a refused IP does not
 * use up the email counter. Returns the refusal, or an allowed result.
 */
export function consumeRateLimits(
  env: Bindings,
  checks: readonly RateCheck[],
  options: ConsumeOptions,
): Promise<RateResult> {
  return runRateLimits(env, checks, options, "consume");
}

/**
 * Reads the counters in order without counting, and returns the first refusal (a full
 * window), or an allowed result.
 */
export function peekRateLimits(
  env: Bindings,
  checks: readonly RateCheck[],
  options: ConsumeOptions,
): Promise<RateResult> {
  return runRateLimits(env, checks, options, "peek");
}

async function runRateLimits(
  env: Bindings,
  checks: readonly RateCheck[],
  options: ConsumeOptions,
  mode: RateMode,
): Promise<RateResult> {
  const backend = backendOverride ?? durableBackend;
  let last: RateResult = { allowed: true, count: 0, retryAfterMs: 0 };
  for (const check of checks) {
    try {
      last = await backend(env, check, mode);
    } catch (err) {
      if (options.onError === "closed") throw err;
      console.error(
        "rate limit check failed, allowing the attempt",
        JSON.stringify({ key: check.key.split(":").slice(0, 2).join(":"), error: String(err) }),
      );
      continue;
    }
    if (!last.allowed) return last;
  }
  return last;
}

/**
 * `consumeRateLimits` for Hono routes. A refusal throws 429 `rate_limited` with a
 * Retry-After header. Fails closed unless `onError` says otherwise.
 */
export async function assertRateLimits(
  env: Bindings,
  checks: readonly RateCheck[],
  options: ConsumeOptions = { onError: "closed" },
): Promise<void> {
  const result = await consumeRateLimits(env, checks, options);
  if (!result.allowed) throw new RateLimitedError(retryAfterSeconds(result));
}

/** The Retry-After value in whole seconds, at least 1. */
export function retryAfterSeconds(result: RateResult): number {
  return Math.max(1, Math.ceil(result.retryAfterMs / 1000));
}
