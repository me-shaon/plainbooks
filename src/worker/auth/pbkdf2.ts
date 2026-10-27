// Password hashing with native PBKDF2-SHA256 through Web Crypto.
//
// better-auth's default scrypt runs in JavaScript and goes past the 10 ms CPU limit of the
// Workers Free plan. Web Crypto PBKDF2 runs natively. The hash string stores the
// algorithm, the iteration count, and the salt, so the count can change later: a sign-in
// with an old hash rehashes it with the current count (see auth.ts).
//
// Format: $pbkdf2-sha256$i=<iterations>$<salt, base64>$<derived key, base64>

const ALGORITHM = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Production Workers refuse PBKDF2 above this count. Local workerd does not. */
export const PBKDF2_MAX_ITERATIONS = 100_000;
/** A lower count is a configuration mistake, so it is raised to this floor. */
export const PBKDF2_MIN_ITERATIONS = 1_000;
/** The count when `PBKDF2_ITERATIONS` is not set. It is the Workers maximum. */
export const PBKDF2_DEFAULT_ITERATIONS = PBKDF2_MAX_ITERATIONS;

const HASH_PATTERN =
  /^\$pbkdf2-sha256\$i=(\d{1,7})\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

export interface ParsedHash {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  key: Uint8Array<ArrayBuffer>;
}

/**
 * The iteration count from the `PBKDF2_ITERATIONS` variable. A missing or invalid value
 * gives the default. The value is clamped to the range that Workers accept.
 */
export function resolveIterations(value: string | number | undefined | null): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return PBKDF2_DEFAULT_ITERATIONS;
  return Math.min(PBKDF2_MAX_ITERATIONS, Math.max(PBKDF2_MIN_ITERATIONS, Math.trunc(parsed)));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Compares two byte arrays in constant time for equal lengths. */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Reads a hash string. Returns null for another format or an out-of-range count. */
export function parseHash(hash: string): ParsedHash | null {
  const match = HASH_PATTERN.exec(hash);
  if (!match) return null;
  const iterations = Number(match[1]);
  if (iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) return null;
  try {
    return {
      iterations,
      salt: fromBase64(match[2] as string),
      key: fromBase64(match[3] as string),
    };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await derive(password, salt, iterations);
  return `$${ALGORITHM}$i=${iterations}$${toBase64(salt)}$${toBase64(key)}`;
}

/** Verifies with the parameters stored in the hash. An unknown format never verifies. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parsed = parseHash(hash);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.iterations);
  return timingSafeEqualBytes(key, parsed.key);
}

/** True when the hash uses another algorithm or another iteration count. */
export function needsRehash(hash: string, iterations: number): boolean {
  const parsed = parseHash(hash);
  return parsed === null || parsed.iterations !== iterations;
}

/** The `emailAndPassword.password` option of better-auth, for one iteration count. */
export function createPasswordHasher(iterations: number) {
  return {
    hash: (password: string) => hashPassword(password, iterations),
    verify: ({ hash, password }: { hash: string; password: string }) =>
      verifyPassword(password, hash),
  };
}
