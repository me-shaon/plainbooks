import type { RateBackend, RateResult } from "../../src/worker/auth/rate-limit";

/**
 * In-memory counters with the same rule logic as the Durable Object. Pass a map to read
 * the counts in a test. The window never ends.
 */
export function memoryRateBackend(counters = new Map<string, number>()): RateBackend {
  return async (_env, check, mode): Promise<RateResult> => {
    const count = counters.get(check.key) ?? 0;
    if (count >= check.rule.limit) {
      return { allowed: false, count, retryAfterMs: check.rule.windowMs };
    }
    if (mode === "peek") return { allowed: true, count, retryAfterMs: 0 };
    counters.set(check.key, count + 1);
    return { allowed: true, count: count + 1, retryAfterMs: 0 };
  };
}
