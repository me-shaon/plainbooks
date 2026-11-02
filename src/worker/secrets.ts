// AUTH_SECRET and ENCRYPTION_KEY without setup. A secret set on the Worker wins. Without one,
// the Worker makes a random value on first use and keeps it in R2 under `secrets/`, so the
// Deploy screen does not ask for them. ENCRYPTION_KEY is in R2, not D1, so a D1 export alone
// does not hold both the encrypted email keys and the key that opens them.
import { usableSecret } from "./auth/crypto";
import type { Bindings } from "./env";

/** The R2 object of each generated secret. Deleting one makes a new value (docs/setup.md). */
export const GENERATED_SECRET_KEYS = {
  AUTH_SECRET: "secrets/auth-secret",
  ENCRYPTION_KEY: "secrets/encryption-key",
} as const;

type SecretName = keyof typeof GENERATED_SECRET_KEYS;
type SecretsEnv = Pick<Bindings, "BUCKET" | SecretName>;

const NAMES = Object.keys(GENERATED_SECRET_KEYS) as SecretName[];

/**
 * The values after the first successful read in this isolate. Only settled values are kept.
 * A pending read belongs to the request that started it: Workers cancel that I/O when the
 * request ends, so another request that awaited the same promise could wait forever.
 */
let generated: Record<SecretName, string> | undefined;

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The value in R2, made first when it is missing. "If-None-Match: *" stops a second isolate
 * from replacing a value that another isolate just made. The value is read back after the
 * write, so every isolate uses the stored value.
 */
async function readOrCreate(bucket: R2Bucket, key: string): Promise<string> {
  const existing = await bucket.get(key);
  if (existing) return (await existing.text()).trim();
  await bucket.put(key, randomSecret(), {
    onlyIf: new Headers({ "if-none-match": "*" }),
    httpMetadata: { contentType: "text/plain" },
  });
  const stored = await bucket.get(key);
  if (!stored) throw new Error(`Could not store the generated secret ${key} in R2`);
  return (await stored.text()).trim();
}

async function loadGenerated(bucket: R2Bucket): Promise<Record<SecretName, string>> {
  const values = await Promise.all(
    NAMES.map((name) => readOrCreate(bucket, GENERATED_SECRET_KEYS[name])),
  );
  return Object.fromEntries(NAMES.map((name, i) => [name, values[i]])) as Record<
    SecretName,
    string
  >;
}

/** `env` with a generated value for each of AUTH_SECRET and ENCRYPTION_KEY that is not set. */
export async function withGeneratedSecrets<E extends SecretsEnv>(env: E): Promise<E> {
  const missing = NAMES.filter((name) => !usableSecret(env[name]));
  if (missing.length === 0) return env;
  // Each request without a cached value reads R2 itself. readOrCreate is safe when two
  // requests make the same secret at the same time.
  generated ??= await loadGenerated(env.BUCKET);
  const values = generated;
  const filled = { ...env };
  for (const name of missing) filled[name] = values[name];
  return filled;
}

/** Tests only: forgets the values read in this isolate. */
export function forgetGeneratedSecretsForTesting(): void {
  generated = undefined;
}
