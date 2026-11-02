import { describe, expect, it } from "vitest";
import { usableSecret } from "../../src/worker/auth/crypto";
import { loadKeyRing } from "../../src/worker/email/settings";

describe("usableSecret", () => {
  it("returns the trimmed secret", () => {
    expect(usableSecret("  a-real-secret-value  ")).toBe("a-real-secret-value");
  });

  it("treats a missing value and the public example values as missing", () => {
    expect(usableSecret(undefined)).toBeNull();
    expect(usableSecret("   ")).toBeNull();
    expect(usableSecret("replace-with-32-or-more-random-characters")).toBeNull();
    expect(usableSecret("replace-with-32-random-bytes-as-base64")).toBeNull();
  });

  it("gives no key ring for the public example ENCRYPTION_KEY", () => {
    expect(loadKeyRing("replace-with-32-random-bytes-as-base64")).toBeNull();
    expect(loadKeyRing(btoa("test-encryption-key-0123456789ab"))).not.toBeNull();
  });
});
