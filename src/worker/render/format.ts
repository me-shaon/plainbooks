// Text formatting for documents. Plain string work, no Intl, to keep renders cheap.
import { formatGrouped } from "../../shared/money";
import { HEX_COLOR } from "../../shared/schemas/settings";
import { todayIn } from "../../shared/time";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "USD 1,234.50". */
export function money(minor: number, currency: string): string {
  return `${currency} ${formatGrouped(minor, currency)}`;
}

/** "28 Sep 2026" from "2026-09-28". Returns the input when it is not an ISO date. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/** The date of a timestamp in the workspace time zone, as "28 Sep 2026". */
export function timestampDate(ms: number, timeZone: string): string {
  return longDate(todayIn(timeZone, ms));
}

export const DEFAULT_ACCENT = "#1f5a4e";

/** The accent color after hex validation. Anything else falls back to the default. */
export function safeAccent(value: string | null | undefined): string {
  return value && HEX_COLOR.test(value) ? value.toLowerCase() : DEFAULT_ACCENT;
}

/** Relative luminance of a validated #rrggbb color (WCAG). */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** White or ink, whichever has more contrast on the accent color. */
export function onAccent(hex: string): string {
  const l = luminance(hex);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (0.011 + 0.05) ? "#ffffff" : "#1b1b19";
}

/** The accent color, darkened for text on white when it is too light. */
export function accentInk(hex: string): string {
  return luminance(hex) > 0.35 ? "#1b1b19" : hex;
}
