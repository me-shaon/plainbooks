/** Every document status that has a pill. "finalized" is the "Ready to send" state. */
export const STATUSES = [
  "draft",
  "finalized",
  "sent",
  "paid",
  "partially_paid",
  "overdue",
  "void",
  "accepted",
  "declined",
  "expired",
  "converted",
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  draft: "Draft",
  finalized: "Ready to send",
  sent: "Sent",
  paid: "Paid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  void: "Void",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted",
};

/**
 * Background and text colors for each pill. They must match the `--pill-*` variables in
 * `styles.css`. A test checks both the match and the 4.5:1 contrast.
 */
export const STATUS_TOKENS: Record<Status, { bg: string; fg: string }> = {
  draft: { bg: "#f3ead6", fg: "#5c4a24" },
  finalized: { bg: "#d3c1f8", fg: "#43268a" },
  sent: { bg: "#d2e5fc", fg: "#17458c" },
  paid: { bg: "#a9e4c8", fg: "#0a5033" },
  partially_paid: { bg: "#fde29c", fg: "#6a4400" },
  overdue: { bg: "#fcc4b2", fg: "#8a270c" },
  void: { bg: "#d3d6d4", fg: "#3f4541" },
  accepted: { bg: "#dcf0a8", fg: "#3c5508" },
  declined: { bg: "#fcd7e8", fg: "#8c1f55" },
  expired: { bg: "#dcc4b2", fg: "#583724" },
  converted: { bg: "#b4e6f0", fg: "#0b4c5d" },
};

/** WCAG 2 contrast ratio of two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace("#", "");
    const channels = [0, 2, 4].map((i) => {
      const c = Number.parseInt(value.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const [r = 0, g = 0, bl = 0] = channels;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
