import { formatGrouped } from "../../shared/money";

/** Minor units as "USD 1,234.50". Uses the shared money module, so it never rounds. */
export function formatMoney(minor: number, currency: string): string {
  return `${currency} ${formatGrouped(minor, currency)}`;
}

/**
 * An ISO date (YYYY-MM-DD) with Intl options, for example `{ month: "long" }` for "October".
 * The date is a calendar day, so it is formatted in UTC. Returns the input when it is not
 * an ISO date.
 */
export function formatIsoDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
    Date.UTC(y, m - 1, d),
  );
}

/** An ISO date (YYYY-MM-DD) as "23 Oct 2026". */
export function formatDate(iso: string | null | undefined): string {
  return formatIsoDate(iso, { day: "numeric", month: "short", year: "numeric" });
}
