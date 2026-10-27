import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertRateLimits,
  consumeRateLimits,
  ipKeyPart,
  peekRateLimits,
  RATE_RULES,
  type RateRule,
  rateKeys,
  setRateBackendForTesting,
} from "../../src/worker/auth/rate-limit";
import { RateLimitedError } from "../../src/worker/errors";

const rule: RateRule = { limit: 5, windowMs: 15 * 60 * 1000 };

/** A counter key that no other test uses. */
const freshKey = () => rateKeys.ip("sign-in", `198.51.100.${crypto.randomUUID()}`);

afterEach(() => setRateBackendForTesting(null));

describe("AuthRateLimiter", () => {
  it("allows 5 attempts per IP in 15 minutes, then refuses until the window ends", async () => {
    const stub = env.AUTH_RATE_LIMITER.getByName(freshKey());
    const start = Date.now();
    for (let i = 1; i <= 5; i++) {
      expect(await stub.consume(rule, start + i)).toMatchObject({ allowed: true, count: i });
    }
    const refused = await stub.consume(rule, start + 10);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(rule.windowMs - 9);
    // A refused attempt does not move the window.
    expect((await stub.consume(rule, start + rule.windowMs)).allowed).toBe(false);
    // The window starts at the first attempt (start + 1).
    expect(await stub.consume(rule, start + 1 + rule.windowMs)).toMatchObject({
      allowed: true,
      count: 1,
    });
  });

  it("never allows more than the limit for concurrent consumes", async () => {
    const stub = env.AUTH_RATE_LIMITER.getByName(freshKey());
    const results = await Promise.all(Array.from({ length: 20 }, () => stub.consume(rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("keeps separate counters per key", async () => {
    const a = env.AUTH_RATE_LIMITER.getByName(freshKey());
    const b = env.AUTH_RATE_LIMITER.getByName(freshKey());
    for (let i = 0; i < 5; i++) await a.consume(rule);
    expect((await a.consume(rule)).allowed).toBe(false);
    expect((await b.consume(rule)).allowed).toBe(true);
  });
});

describe("AuthRateLimiter.peek", () => {
  it("reads the count without counting, and refuses only a full window", async () => {
    const stub = env.AUTH_RATE_LIMITER.getByName(freshKey());
    const start = Date.now();
    expect(await stub.peek(rule, start)).toMatchObject({ allowed: true, count: 0 });
    for (let i = 1; i <= 4; i++) await stub.consume(rule, start + i);
    expect(await stub.peek(rule, start + 5)).toMatchObject({ allowed: true, count: 4 });
    expect(await stub.peek(rule, start + 5)).toMatchObject({ allowed: true, count: 4 });
    await stub.consume(rule, start + 5);
    const full = await stub.peek(rule, start + 6);
    expect(full).toMatchObject({ allowed: false, count: 5 });
    expect(full.retryAfterMs).toBe(rule.windowMs - 5);
    expect(await stub.peek(rule, start + 1 + rule.windowMs)).toMatchObject({ allowed: true });
  });

  it("peekRateLimits returns the first full counter", async () => {
    const full = freshKey();
    const stub = env.AUTH_RATE_LIMITER.getByName(full);
    for (let i = 0; i < 5; i++) await stub.consume(rule);
    const checks = [
      { key: freshKey(), rule },
      { key: full, rule },
    ];
    expect((await peekRateLimits(env, checks, { onError: "open" })).allowed).toBe(false);
    expect(
      (await peekRateLimits(env, [checks[0] ?? { key: "", rule }], { onError: "open" })).count,
    ).toBe(0);
  });
});

describe("rate keys", () => {
  it("groups IPv6 addresses by /64 and keeps IPv4 addresses whole", () => {
    expect(ipKeyPart("198.51.100.7")).toBe("198.51.100.7");
    expect(ipKeyPart("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(ipKeyPart("2001:db8:1:2::a")).toBe("2001:db8:1:2::/64");
    expect(ipKeyPart("2001:0DB8:0001:0002:ffff:0:0:1")).toBe("2001:db8:1:2::/64");
    expect(ipKeyPart("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKeyPart("unknown")).toBe("unknown");
    expect(rateKeys.ip("sign-in", "2001:db8:1:2::a")).toBe(
      rateKeys.ip("sign-in", "2001:db8:1:2::b"),
    );
    expect(rateKeys.ip("sign-in", "2001:db8:1:2::a")).not.toBe(
      rateKeys.ip("sign-in", "2001:db8:1:3::a"),
    );
  });

  it("hashes the lowercase email, so no key holds the address", async () => {
    const key = await rateKeys.email("sign-in", " Owner@Example.com ");
    expect(key).toBe(await rateKeys.email("sign-in", "owner@example.com"));
    expect(key).toMatch(/^sign-in:email:[0-9a-f]{64}$/);
    expect(key).not.toContain("example");
    expect(rateKeys.global("setup")).toBe("setup:global");
  });
});

describe("consumeRateLimits", () => {
  it("stops at the first refusal, so a refused IP does not use the email counter", async () => {
    const ipKey = freshKey();
    const emailKey = await rateKeys.email("sign-in", `${crypto.randomUUID()}@example.com`);
    const checks = [
      { key: ipKey, rule: RATE_RULES.signInIp },
      { key: emailKey, rule: RATE_RULES.signInEmail },
    ];
    for (let i = 0; i < 5; i++) {
      expect((await consumeRateLimits(env, checks, { onError: "closed" })).allowed).toBe(true);
    }
    expect((await consumeRateLimits(env, checks, { onError: "closed" })).allowed).toBe(false);
    const email = await env.AUTH_RATE_LIMITER.getByName(emailKey).consume(RATE_RULES.signInEmail);
    expect(email.count).toBe(6);
  });

  it("fails open or closed when the counter call throws", async () => {
    setRateBackendForTesting(async () => {
      throw new Error("Durable Object unavailable");
    });
    const checks = [{ key: freshKey(), rule }];
    expect((await consumeRateLimits(env, checks, { onError: "open" })).allowed).toBe(true);
    await expect(consumeRateLimits(env, checks, { onError: "closed" })).rejects.toThrow(
      "Durable Object unavailable",
    );
    await expect(assertRateLimits(env, checks)).rejects.toThrow("Durable Object unavailable");
  });

  it("assertRateLimits throws 429 with the retry time", async () => {
    setRateBackendForTesting(async () => ({ allowed: false, count: 5, retryAfterMs: 61_500 }));
    const err = await assertRateLimits(env, [{ key: freshKey(), rule }]).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 62 });
  });
});
