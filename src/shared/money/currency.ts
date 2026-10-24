// ISO 4217 currency exponents (number of minor-unit digits).
import { formatScaled, MoneyError, parseScaled } from "./decimal";

export const HOME_CURRENCY = "BDT";

/** Currencies whose exponent is not 2 (ISO 4217 list one). */
const NON_DEFAULT_EXPONENTS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

/** Active ISO 4217 currencies with exponent 2. */
// biome-ignore format: keep the code table compact
const TWO_DECIMAL_CODES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT",
  "BGN", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF",
  "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR",
  "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF",
  "IDR", "ILS", "INR", "IRR", "JMD", "KES", "KGS", "KHR", "KPW", "KYD", "KZT", "LAK", "LBP",
  "LKR", "LRD", "LSL", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR",
  "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "PAB", "PEN", "PGK",
  "PHP", "PKR", "PLN", "QAR", "RON", "RSD", "RUB", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD",
  "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TOP",
  "TRY", "TTD", "TWD", "TZS", "UAH", "USD", "UYU", "UZS", "VES", "WST", "XCD", "YER", "ZAR",
  "ZMW", "ZWG",
] as const;

export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  ...Object.fromEntries(TWO_DECIMAL_CODES.map((code) => [code, 2])),
  ...NON_DEFAULT_EXPONENTS,
});

export const CURRENCY_CODES: readonly string[] = Object.freeze(
  Object.keys(CURRENCY_EXPONENTS).sort(),
);

export function isCurrencyCode(code: string): boolean {
  return Object.hasOwn(CURRENCY_EXPONENTS, code);
}

/** Returns the ISO 4217 exponent. Throws MoneyError for an unknown code. */
export function getExponent(code: string): number {
  const exponent = CURRENCY_EXPONENTS[code];
  if (exponent === undefined) throw new MoneyError(`Unknown currency: ${code}`);
  return exponent;
}

/** Parses a major-unit decimal ("1500.00") to integer minor units. */
export function parseMinor(input: string | number, currency: string): number {
  const exponent = getExponent(currency);
  const scaled = parseScaled(input, exponent, `${currency} amount`);
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER) || -scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`${currency} amount is too large`);
  }
  return Number(scaled);
}

/** Formats minor units as a plain major-unit decimal ("2147.95"). No grouping or symbol. */
export function formatMinor(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new MoneyError("Amount must be an integer");
  return formatScaled(BigInt(minor), getExponent(currency));
}

/** Formats minor units as a major-unit decimal with thousands separators ("2,147.95"). */
export function formatGrouped(minor: number, currency: string): string {
  const text = formatMinor(minor, currency);
  const sign = text.startsWith("-") ? "-" : "";
  const body = sign ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? "" : body.slice(dot);
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
}
