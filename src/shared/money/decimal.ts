// Exact decimal helpers. Pure TypeScript with no Node APIs, so the worker and the web app share it.

/** Raised for every invalid money input (bad amount, rate, quantity, or discount). */
export class MoneyError extends Error {
  override name = "MoneyError";
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a plain decimal ("12.5", "-0.333", 7) into an integer scaled by 10^decimals.
 * Rejects exponents, separators, and more fraction digits than `decimals`.
 * Trailing zeros past `decimals` are allowed ("1.500" with decimals 1 is 15n).
 */
export function parseScaled(input: string | number, decimals: number, what = "value"): bigint {
  if (typeof input === "number" && !Number.isFinite(input)) {
    throw new MoneyError(`Invalid ${what}: ${input}`);
  }
  const text = typeof input === "number" ? String(input) : input.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new MoneyError(`Invalid ${what}: ${JSON.stringify(input)}`);
  const [, sign, whole = "0", rawFraction = ""] = match;
  const fraction = rawFraction.replace(/0+$/, "");
  if (fraction.length > decimals) {
    throw new MoneyError(`Too many decimal places in ${what}: ${text} (max ${decimals})`);
  }
  const scaled = BigInt(whole + fraction.padEnd(decimals, "0"));
  return sign ? -scaled : scaled;
}

/** Formats an integer scaled by 10^decimals as a plain decimal string with exactly `decimals` digits. */
export function formatScaled(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Integer division that rounds half away from zero. `den` must be positive. */
export function roundDiv(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new MoneyError("Division by a non-positive number");
  const negative = num < 0n;
  const abs = negative ? -num : num;
  const quotient = (abs * 2n + den) / (den * 2n);
  return negative ? -quotient : quotient;
}

/** Converts a bigint to a number, failing if it would lose precision. */
export function toSafeNumber(value: bigint, what = "amount"): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${what} is too large`);
  }
  return Number(value);
}

/** Checks that a minor-unit amount is a safe integer. */
export function assertMinor(value: number, what: string, allowNegative = false): void {
  if (!Number.isSafeInteger(value)) throw new MoneyError(`${what} must be an integer`);
  if (!allowNegative && value < 0) throw new MoneyError(`${what} must not be negative`);
}
