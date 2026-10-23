// Editor values, their conversion to the API body, and the live totals.
import type { DocumentKind, ReminderModeSetting } from "../../../shared/domain";
import {
  calculateTotals,
  type DocumentTotals,
  formatMinor,
  type LineInput,
  parseMinor,
  parseQuantity,
} from "../../../shared/money";
import type { DocumentDetail, DocumentUpdateInput } from "../../../shared/schemas/document";
import type { TaxRate } from "../../../shared/schemas/tax-rate";
import { currencyDecimals, fitAmountText } from "../../components/ui/money-field";

export interface LineDraft {
  /** A stable React key. */
  key: string;
  description: string;
  quantity: string;
  /** Major units as typed. */
  unitPrice: string;
  taxRateId: string | null;
}

export type DueMode = "terms" | "date";

export interface EditorValues {
  kind: DocumentKind;
  clientId: string | null;
  currency: string;
  /** Null means "the send date". */
  issueDate: string | null;
  dueMode: DueMode;
  dueDate: string | null;
  /** Empty means the client terms, then the workspace terms. */
  paymentTermsDays: string;
  expiryDate: string | null;
  lines: LineDraft[];
  discountType: "none" | "percent" | "fixed";
  discountPercent: string;
  /** Major units as typed. */
  discountAmount: string;
  notes: string;
  templateId: string | null;
  reminderMode: ReminderModeSetting;
  /** A manual exchange rate. Null means the fetched rate. */
  fxManual: { rate: string; date: string } | null;
  customFields: Record<string, string>;
}

let keySeed = 0;
export function newLine(taxRateId: string | null = null): LineDraft {
  keySeed += 1;
  return { key: `line-${keySeed}`, description: "", quantity: "1", unitPrice: "", taxRateId };
}

export function emptyValues(kind: DocumentKind, currency: string): EditorValues {
  return {
    kind,
    clientId: null,
    currency,
    issueDate: null,
    dueMode: "terms",
    dueDate: null,
    paymentTermsDays: "",
    expiryDate: null,
    lines: [newLine()],
    discountType: "none",
    discountPercent: "",
    discountAmount: "",
    notes: "",
    templateId: null,
    reminderMode: "inherit",
    fxManual: null,
    customFields: {},
  };
}

export function valuesFromDetail(detail: DocumentDetail): EditorValues {
  const { discount } = detail;
  return {
    kind: detail.kind,
    clientId: detail.clientId,
    currency: detail.currency,
    issueDate: detail.issueDate,
    dueMode: detail.dueDate && detail.paymentTermsDays === null ? "date" : "terms",
    dueDate: detail.dueDate,
    paymentTermsDays: detail.paymentTermsDays === null ? "" : String(detail.paymentTermsDays),
    expiryDate: detail.expiryDate,
    lines: detail.lines.map((line) => ({
      key: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: formatMinor(line.unitPrice, detail.currency),
      taxRateId: line.taxRateId,
    })),
    discountType: discount.type,
    discountPercent: discount.type === "percent" ? discount.percent : "",
    discountAmount: discount.type === "fixed" ? formatMinor(discount.amount, detail.currency) : "",
    notes: detail.notes ?? "",
    templateId: detail.templateId,
    reminderMode: detail.reminderMode,
    fxManual:
      detail.fx.overridden && detail.fx.rate && detail.fx.rateDate
        ? { rate: detail.fx.rate, date: detail.fx.rateDate }
        : null,
    customFields: Object.fromEntries(detail.customFields.map((f) => [f.fieldId, f.value])),
  };
}

/** Minor units for typed text. Empty or invalid text counts as 0. */
export function minorOf(text: string, currency: string): number {
  if (!text.trim()) return 0;
  try {
    return parseMinor(text, currency);
  } catch {
    return 0;
  }
}

function quantityOf(text: string): string {
  try {
    parseQuantity(text);
    return text;
  } catch {
    return "0";
  }
}

/** Keeps the typed amounts when the currency changes, cutting decimals it does not allow. */
export function changeCurrency(values: EditorValues, currency: string): EditorValues {
  const decimals = currencyDecimals(currency);
  return {
    ...values,
    currency,
    lines: values.lines.map((line) => ({
      ...line,
      unitPrice: fitAmountText(line.unitPrice, decimals),
    })),
    discountAmount: fitAmountText(values.discountAmount, decimals),
  };
}

export interface EditorTotals {
  totals: DocumentTotals;
  /** Set when the discount cannot apply, for example when it is above the subtotal. */
  discountError: string | null;
}

/** The shared money engine's totals for the current values. */
export function editorTotals(values: EditorValues, taxRates: TaxRate[]): EditorTotals {
  const rates = new Map(taxRates.map((rate) => [rate.id, rate]));
  const lines: LineInput[] = values.lines.map((line) => {
    const rate = line.taxRateId ? rates.get(line.taxRateId) : undefined;
    return {
      quantity: quantityOf(line.quantity || "0"),
      unitPrice: minorOf(line.unitPrice, values.currency),
      tax: rate ? { id: rate.id, name: rate.name, rate: rate.rate } : null,
    };
  });
  let discount: Parameters<typeof calculateTotals>[0]["discount"] = null;
  if (values.discountType === "percent" && values.discountPercent.trim()) {
    discount = { type: "percent", percent: values.discountPercent };
  } else if (values.discountType === "fixed") {
    discount = { type: "fixed", amount: minorOf(values.discountAmount, values.currency) };
  }
  try {
    return {
      totals: calculateTotals({ currency: values.currency, lines, discount }),
      discountError: null,
    };
  } catch {
    // An invalid percent or a discount above the subtotal: show totals without it.
    return {
      totals: calculateTotals({ currency: values.currency, lines, discount: null }),
      discountError:
        values.discountType === "percent"
          ? "Enter a percent from 0 to 100"
          : "The discount is larger than the subtotal",
    };
  }
}

/** The API body (create, update, or revise). `includeFx` false leaves the stored rate alone. */
export function toDocumentInput(
  values: EditorValues,
  { includeFx = true }: { includeFx?: boolean } = {},
): DocumentUpdateInput & { kind: DocumentKind; clientId: string } {
  const discount =
    values.discountType === "percent"
      ? { type: "percent" as const, percent: values.discountPercent || "0" }
      : values.discountType === "fixed"
        ? { type: "fixed" as const, amount: minorOf(values.discountAmount, values.currency) }
        : { type: "none" as const };
  const isInvoice = values.kind === "invoice";
  const terms = values.paymentTermsDays.trim();
  return {
    kind: values.kind,
    clientId: values.clientId ?? "",
    currency: values.currency,
    issueDate: values.issueDate,
    dueDate: isInvoice && values.dueMode === "date" ? values.dueDate : null,
    paymentTermsDays: isInvoice && values.dueMode === "terms" && terms ? Number(terms) : null,
    expiryDate: isInvoice ? null : values.expiryDate,
    lines: values.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity || "0",
      unitPrice: minorOf(line.unitPrice, values.currency),
      taxRateId: line.taxRateId,
    })),
    discount,
    notes: values.notes,
    templateId: values.templateId,
    reminderMode: isInvoice ? values.reminderMode : "inherit",
    ...(includeFx ? { fxRate: values.fxManual } : {}),
    customFields: Object.entries(values.customFields).map(([fieldId, value]) => ({
      fieldId,
      value,
    })),
  };
}

/** Moves the item at `from` to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
