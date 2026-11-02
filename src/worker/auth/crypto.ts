// Small Web Crypto helpers for the auth code.

/** The SHA-256 of a UTF-8 string, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings of the same length in constant time. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The example values that `.dev.vars.example` held until v0.1.3. They are public, and the
 * Deploy button put them in its secret fields, so a deploy may still use one. The app treats
 * them as missing.
 */
const PUBLIC_EXAMPLE_SECRETS = new Set([
  "replace-with-32-or-more-random-characters",
  "replace-with-32-random-bytes-as-base64",
]);

/** The trimmed secret, or null when it is missing or one of the public example values. */
export function usableSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  return secret && !PUBLIC_EXAMPLE_SECRETS.has(secret) ? secret : null;
}
