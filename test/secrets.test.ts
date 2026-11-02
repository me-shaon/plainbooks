import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/worker/auth/auth";
import { loadKeyRing } from "../src/worker/email/settings";
import type { Bindings } from "../src/worker/env";
import {
  forgetGeneratedSecretsForTesting,
  GENERATED_SECRET_KEYS,
  withGeneratedSecrets,
} from "../src/worker/secrets";

/** The test env without the two secrets, as on a fresh Deploy button copy. */
function freshEnv(overrides: Partial<Bindings> = {}): Bindings {
  return { ...env, AUTH_SECRET: undefined, ENCRYPTION_KEY: undefined, ...overrides };
}

async function stored(key: string): Promise<string | null> {
  const object = await env.BUCKET.get(key);
  return object ? object.text() : null;
}

async function clear() {
  forgetGeneratedSecretsForTesting();
  await env.BUCKET.delete(Object.values(GENERATED_SECRET_KEYS));
}

beforeEach(clear);
afterEach(clear);

describe("withGeneratedSecrets", () => {
  it("keeps the secrets that are set and touches no R2 object", async () => {
    const result = await withGeneratedSecrets(env);
    expect(result).toBe(env);
    expect(await stored(GENERATED_SECRET_KEYS.AUTH_SECRET)).toBeNull();
  });

  it("makes each missing secret once and keeps it in R2", async () => {
    const first = await withGeneratedSecrets(freshEnv());
    expect(first.AUTH_SECRET).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(first.ENCRYPTION_KEY).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(first.AUTH_SECRET).not.toBe(first.ENCRYPTION_KEY);
    expect(await stored(GENERATED_SECRET_KEYS.AUTH_SECRET)).toBe(first.AUTH_SECRET);
    expect(await stored(GENERATED_SECRET_KEYS.ENCRYPTION_KEY)).toBe(first.ENCRYPTION_KEY);

    // A new isolate reads the same values from R2.
    forgetGeneratedSecretsForTesting();
    const second = await withGeneratedSecrets(freshEnv());
    expect(second.AUTH_SECRET).toBe(first.AUTH_SECRET);
    expect(second.ENCRYPTION_KEY).toBe(first.ENCRYPTION_KEY);
  });

  it("fills only the missing secret, and replaces a public example value", async () => {
    const result = await withGeneratedSecrets(
      freshEnv({
        AUTH_SECRET: "a-secret-that-the-owner-set-0123456789",
        ENCRYPTION_KEY: "replace-with-32-random-bytes-as-base64",
      }),
    );
    expect(result.AUTH_SECRET).toBe("a-secret-that-the-owner-set-0123456789");
    expect(result.ENCRYPTION_KEY).toBe(await stored(GENERATED_SECRET_KEYS.ENCRYPTION_KEY));
  });

  it("does not replace a value that another isolate stored first", async () => {
    await env.BUCKET.put(GENERATED_SECRET_KEYS.AUTH_SECRET, "made-by-another-isolate");
    const result = await withGeneratedSecrets(freshEnv());
    expect(result.AUTH_SECRET).toBe("made-by-another-isolate");
    // R2 refuses a second create, so the first value stays.
    const refused = await env.BUCKET.put(GENERATED_SECRET_KEYS.AUTH_SECRET, "second", {
      onlyIf: new Headers({ "if-none-match": "*" }),
    });
    expect(refused).toBeNull();
    expect(await stored(GENERATED_SECRET_KEYS.AUTH_SECRET)).toBe("made-by-another-isolate");
  });

  it("does not make a request wait on another request's unfinished R2 read", async () => {
    await withGeneratedSecrets(freshEnv());
    forgetGeneratedSecretsForTesting();
    // The first request's read never ends, as when Workers cancel the I/O of a request
    // that closed. A shared pending promise would make every later request wait too.
    const stuck = { ...env.BUCKET, get: () => new Promise<never>(() => {}) } as R2Bucket;
    void withGeneratedSecrets(freshEnv({ BUCKET: stuck }));

    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1000));
    const second = await Promise.race([withGeneratedSecrets(freshEnv()), timeout]);
    expect(second).not.toBe("timeout");
    if (second === "timeout") return;
    expect(second.AUTH_SECRET).toBe(await stored(GENERATED_SECRET_KEYS.AUTH_SECRET));
  });

  it("gives values that the auth code and the key ring accept", async () => {
    const filled = await withGeneratedSecrets(freshEnv());
    expect(() => createAuth(filled, new Request("https://invoices.example.com/"))).not.toThrow();
    expect(loadKeyRing(filled.ENCRYPTION_KEY)).not.toBeNull();
  });
});
