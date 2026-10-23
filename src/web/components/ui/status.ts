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
  draft: { bg: "#f1efea", fg: "#57534c" },
  finalized: { bg: "#efeaf7", fg: "#4f3b78" },
  sent: { bg: "#e8eef6", fg: "#2c4a6e" },
  paid: { bg: "#e3f1ee", fg: "#1f5a4e" },
  partially_paid: { bg: "#f8eedb", fg: "#6b4a12" },
  overdue: { bg: "#fbe5de", fg: "#8a3b26" },
  void: { bg: "#eeefee", fg: "#4f5751" },
  accepted: { bg: "#e4f1e6", fg: "#25562f" },
  declined: { bg: "#f7e4e8", fg: "#7a2e3d" },
  expired: { bg: "#f0f2f0", fg: "#5f6661" },
  converted: { bg: "#e6eff3", fg: "#24506a" },
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
