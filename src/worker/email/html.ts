// Escaping helpers for email templates. Every interpolated value is escaped unless it is
// already SafeHtml, so client text (quote comments, names) can never inject markup.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** HTML that is already escaped. Only `html` and `raw` create it. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Trusted static markup. Never pass user data. */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

type Value = SafeHtml | string | number | null | undefined | false | Value[];

function render(value: Value): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

/** Tagged template: escapes every interpolation. */
export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? "");
  });
  return new SafeHtml(out);
}

/** Escaped text with line breaks kept as <br>. */
export function multiline(text: string): SafeHtml {
  return raw(escapeHtml(text).replace(/\r?\n/g, "<br>"));
}

/** Only http(s) links are allowed in href attributes. */
export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}
