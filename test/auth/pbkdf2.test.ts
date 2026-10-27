import { describe, expect, it } from "vitest";
import {
  createPasswordHasher,
  hashPassword,
  needsRehash,
  PBKDF2_DEFAULT_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  PBKDF2_MIN_ITERATIONS,
  parseHash,
  resolveIterations,
  verifyPassword,
} from "../../src/worker/auth/pbkdf2";

describe("PBKDF2 hasher", () => {
  it("verifies its own hash and rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery", 5_000);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("stores the algorithm, the iterations, and a random salt in the hash", async () => {
    const a = await hashPassword("same password", 5_000);
    const b = await hashPassword("same password", 5_000);
    expect(a).toMatch(/^\$pbkdf2-sha256\$i=5000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    const parsed = parseHash(a);
    expect(parsed?.iterations).toBe(5_000);
    expect(parsed?.salt).toHaveLength(16);
    expect(parsed?.key).toHaveLength(32);
  });

  it("verifies with the iterations in the hash, not the current setting", async () => {
    const old = await hashPassword("pw-123456789", 2_000);
    const hasher = createPasswordHasher(PBKDF2_MAX_ITERATIONS);
    expect(await hasher.verify({ hash: old, password: "pw-123456789" })).toBe(true);
  });

  it("hashes at the default count, which the Workers runtime accepts", async () => {
    const hasher = createPasswordHasher(PBKDF2_DEFAULT_ITERATIONS);
    const hash = await hasher.hash("a long enough password");
    expect(parseHash(hash)?.iterations).toBe(100_000);
    expect(await hasher.verify({ hash, password: "a long enough password" })).toBe(true);
  });

  it("never verifies an unknown or broken hash format", async () => {
    for (const hash of [
      "",
      "plain",
      "salt:hex", // better-auth's scrypt format
      "$pbkdf2-sha256$i=0$AAAA$AAAA",
      "$pbkdf2-sha256$i=100001$AAAA$AAAA",
      "$pbkdf2-sha1$i=1000$AAAA$AAAA",
      "$pbkdf2-sha256$i=1000$!!!$AAAA",
    ]) {
      expect(await verifyPassword("anything", hash), hash).toBe(false);
    }
  });

  it("flags a hash with a lower iteration count for rehash", async () => {
    const hash = await hashPassword("pw-123456789", 2_000);
    expect(needsRehash(hash, 2_000)).toBe(false);
    expect(needsRehash(hash, PBKDF2_DEFAULT_ITERATIONS)).toBe(true);
    expect(needsRehash("salt:hex", 2_000)).toBe(true);
  });

  it("reads the iteration count from the variable and clamps it", () => {
    expect(resolveIterations(undefined)).toBe(PBKDF2_DEFAULT_ITERATIONS);
    expect(resolveIterations("")).toBe(PBKDF2_DEFAULT_ITERATIONS);
    expect(resolveIterations("abc")).toBe(PBKDF2_DEFAULT_ITERATIONS);
    expect(resolveIterations("50000")).toBe(50_000);
    expect(resolveIterations("250000")).toBe(PBKDF2_MAX_ITERATIONS);
    expect(resolveIterations("10")).toBe(PBKDF2_MIN_ITERATIONS);
    expect(resolveIterations(75_000.9)).toBe(75_000);
  });
});
