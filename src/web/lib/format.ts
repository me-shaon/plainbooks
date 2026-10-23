import { formatMinor } from "../../shared/money";

/** Adds thousands separators to a plain decimal string, for example "1234.50" to "1,234.50". */
export function groupDigits(text: string): string {
  const [whole = "", fraction] = text.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

/** Minor units as "USD 1,234.50". Uses the shared money module, so it never rounds. */
export function formatMoney(minor: number, currency: string): string {
  return `${currency} ${groupDigits(formatMinor(minor, currency))}`;
}

/** An ISO date (YYYY-MM-DD) as "23 Oct 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(y, m - 1, d));
}
