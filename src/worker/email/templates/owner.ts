// Owner notification and team member emails. Every value is escaped, including client comments.
import { html, multiline } from "../html";
import { type EmailContent, layout } from "./layout";

interface OwnerBase {
  /** The workspace name. */
  workspace: string;
  accent?: string | null;
  /** A link into the app. */
  url: string;
}

function ownerEmail(
  base: OwnerBase,
  subject: string,
  lines: string[],
  quote?: string | null,
  action = "Open in the app",
): EmailContent {
  const body = html`${lines.map((line) => html`<p style="margin:0 0 12px">${line}</p>`)}${
    quote
      ? html`<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #d0d0cb;color:#3a3a36">${multiline(quote)}</blockquote>`
      : ""
  }`;
  const text = [...lines, ...(quote ? ["", `"${quote}"`] : []), "", `${action}: ${base.url}`].join(
    "\n",
  );
  return {
    subject,
    html: layout({
      accent: base.accent,
      from: base.workspace,
      preheader: lines[0],
      body,
      action: { label: action, url: base.url },
    }),
    text,
  };
}

export function quoteDecisionEmail(
  input: OwnerBase & {
    number: string;
    clientName: string;
    decision: "accepted" | "declined";
    comment?: string | null;
  },
): EmailContent {
  const verb = input.decision === "accepted" ? "accepted" : "declined";
  return ownerEmail(
    input,
    `${input.clientName} ${verb} quote ${input.number}`,
    [
      `${input.clientName} ${verb} quote ${input.number}.`,
      ...(input.comment?.trim() ? ["Their comment:"] : []),
    ],
    input.comment?.trim() || null,
    "Open the quote",
  );
}

export function bounceEmail(
  input: OwnerBase & {
    event: "bounced" | "complained";
    recipients: string[];
    subject: string;
    number?: string | null;
    reason?: string | null;
  },
): EmailContent {
  const who = input.recipients.join(", ") || "the recipient";
  const what = input.number ? ` for ${input.number}` : "";
  const lines =
    input.event === "bounced"
      ? [`An email${what} to ${who} bounced.`, `Subject: ${input.subject}`]
      : [`${who} marked an email${what} as spam.`, `Subject: ${input.subject}`];
  if (input.reason) lines.push(`Reason: ${input.reason}`);
  lines.push("Check the email address and send the document again.");
  return ownerEmail(
    input,
    input.event === "bounced" ? `Email bounced${what}` : `Spam complaint${what}`,
    lines,
  );
}

export function recurringDraftReadyEmail(
  input: OwnerBase & { clientName: string; issueDate: string; scheduleName?: string | null },
): EmailContent {
  return ownerEmail(
    input,
    `Recurring invoice draft ready for ${input.clientName}`,
    [
      `A recurring invoice draft for ${input.clientName} is ready${input.scheduleName ? ` (${input.scheduleName})` : ""}.`,
      `Issue date: ${input.issueDate}. Review it and send it.`,
    ],
    null,
    "Review the draft",
  );
}

export function fxRateNeededEmail(
  input: OwnerBase & { clientName: string; currency: string; homeCurrency: string; date: string },
): EmailContent {
  return ownerEmail(
    input,
    `Exchange rate needed for ${input.clientName}`,
    [
      `The app could not get the ${input.currency} to ${input.homeCurrency} rate for ${input.date}.`,
      "Enter the rate manually, then send the invoice.",
    ],
    null,
    "Enter the rate",
  );
}

/** The self-service password reset link for a team member. */
export function passwordResetEmail(input: OwnerBase & { expiresInMinutes: number }): EmailContent {
  return ownerEmail(
    input,
    `Reset your ${input.workspace} password`,
    [
      "Someone asked to reset the password for your account. Use the link to set a new password.",
      `The link works once and expires in ${input.expiresInMinutes} minutes.`,
      "If you did not ask for this, ignore this email. Your password stays the same.",
    ],
    null,
    "Set a new password",
  );
}
