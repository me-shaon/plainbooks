import { safeAccent } from "../../render/format";
import { html, type SafeHtml, safeUrl } from "../html";

/** What every template returns. `text` is the plain-text alternative. */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface LayoutInput {
  /** The brand accent color. Invalid values fall back to the default accent. */
  accent?: string | null;
  /** Business or workspace name, shown in the header and footer. */
  from: string;
  /** Hidden preview text. */
  preheader?: string;
  body: SafeHtml;
  /** A call to action button. */
  action?: { label: string; url: string };
  footer?: string | null;
}

/** A plain, table-based email body that renders in common email clients. */
export function layout(input: LayoutInput): string {
  const accent = safeAccent(input.accent);
  const action = input.action
    ? html`<p style="margin:24px 0"><a href="${safeUrl(input.action.url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${input.action.label}</a></p>`
    : "";
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1b">${
    input.preheader
      ? html`<div style="display:none;max-height:0;overflow:hidden">${input.preheader}</div>`
      : ""
  }<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${accent}"><tr><td style="padding:28px 28px 8px;font-size:15px;line-height:1.55"><p style="margin:0 0 20px;font-weight:600;font-size:16px">${input.from}</p>${input.body}${action}</td></tr><tr><td style="padding:16px 28px 24px;font-size:12px;line-height:1.5;color:#6b6b66">${input.footer ? input.footer : input.from}</td></tr></table></td></tr></table></body></html>`.toString();
}

/** A label and value row for summaries. Both are escaped. */
export function summaryTable(rows: [string, string][]): SafeHtml {
  return html`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${rows.map(
    ([label, value]) =>
      html`<tr><td style="padding:4px 16px 4px 0;color:#6b6b66">${label}</td><td style="padding:4px 0;font-weight:600">${value}</td></tr>`,
  )}</table>`;
}

export function textSummary(rows: [string, string][]): string {
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}
