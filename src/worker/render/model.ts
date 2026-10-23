// The view model that layouts and sections read. Built once per render from the snapshot
// and the live document state.
import type { DocumentStatus, TemplateSection } from "../../shared/domain";
import {
  type DocumentSnapshot,
  isOverdue,
  type SnapshotCustomField,
} from "../../shared/schemas/document";
import { logoUrl } from "../../shared/schemas/settings";
import { normalizeTemplateConfig } from "../../shared/schemas/template";
import { longDate, money, timestampDate } from "./format";

export type RenderMode = "page" | "pdf";

/**
 * Live document state that the snapshot does not hold: status, payments, and the quote
 * decision. Draft previews use `previewState`.
 */
export interface RenderState {
  status: DocumentStatus;
  /** Payments and write-offs, in minor units of the document currency. */
  amountPaid: number;
  /** The workspace date (YYYY-MM-DD), for overdue and expiry checks. */
  today: string;
  timeZone: string;
  decidedAt: number | null;
  decisionComment: string | null;
}

export interface Banner {
  tone: "neutral" | "danger" | "success" | "warning";
  title: string;
  body?: string;
  comment?: string;
}

export interface FieldView {
  label: string;
  value: string;
}

export interface DocumentView {
  snapshot: DocumentSnapshot;
  state: RenderState;
  mode: RenderMode;
  kindLabel: "Invoice" | "Quote";
  isInvoice: boolean;
  /** The image source for the logo, or null. */
  logoSrc: string | null;
  sections: { id: TemplateSection; visible: boolean }[];
  fields: (section: TemplateSection) => FieldView[];
  banners: Banner[];
  /** False for quotes and for paid or void invoices. */
  showPaymentDetails: boolean;
  isVoid: boolean;
  balance: number;
  money: (minor: number) => string;
}

function fieldValue(field: SnapshotCustomField): string {
  return field.type === "date" ? longDate(field.value) : field.value;
}

/** Status banners for the document, in display order. */
export function documentBanners(snapshot: DocumentSnapshot, state: RenderState): Banner[] {
  const doc = snapshot.document;
  const banners: Banner[] = [];
  const total = snapshot.totals.total;
  const fmt = (minor: number) => money(minor, doc.currency);
  const balance = Math.max(0, total - state.amountPaid);

  if (doc.kind === "invoice") {
    if (state.status === "void") {
      banners.push({ tone: "danger", title: "Void", body: "This invoice is void. Do not pay it." });
    } else if (state.status === "paid") {
      banners.push({ tone: "success", title: "Paid", body: "This invoice is paid in full." });
    } else if (state.status === "partially_paid") {
      banners.push({
        tone: "warning",
        title: "Partially paid",
        body: `Paid ${fmt(state.amountPaid)}. Balance due ${fmt(balance)}.`,
      });
    }
    const overdue = isOverdue(
      {
        kind: doc.kind,
        status: state.status,
        number: doc.number,
        dueDate: doc.dueDate,
        expiryDate: doc.expiryDate,
        total,
        amountPaid: state.amountPaid,
      },
      state.today,
    );
    if (overdue) {
      banners.push({
        tone: "danger",
        title: "Overdue",
        body: `This invoice was due on ${longDate(doc.dueDate)}.`,
      });
    }
  } else {
    const decided = state.decidedAt ? timestampDate(state.decidedAt, state.timeZone) : null;
    if (state.status === "accepted" || state.status === "converted") {
      banners.push({
        tone: "success",
        title: decided ? `Accepted on ${decided}` : "Accepted",
        comment: state.decisionComment ?? undefined,
      });
    } else if (state.status === "declined") {
      banners.push({
        tone: "neutral",
        title: decided ? `Declined on ${decided}` : "Declined",
        comment: state.decisionComment ?? undefined,
      });
    } else if (
      state.status === "expired" ||
      (state.status === "sent" && doc.expiryDate !== null && doc.expiryDate < state.today)
    ) {
      banners.push({
        tone: "warning",
        title: `This quote expired on ${longDate(doc.expiryDate)}`,
      });
    }
  }
  if (doc.revisionNumber > 1) {
    banners.push({
      tone: "neutral",
      title: `Revised on ${timestampDate(snapshot.createdAt, state.timeZone)}`,
    });
  }
  return banners;
}

export function buildView(
  snapshot: DocumentSnapshot,
  state: RenderState,
  mode: RenderMode,
  logoSrc: string | null | undefined,
): DocumentView {
  const config = normalizeTemplateConfig(snapshot.template.config);
  const placement = new Map(config.customFields.map((f) => [f.fieldId, f.section]));
  const bySection = new Map<TemplateSection, FieldView[]>();
  for (const field of snapshot.customFields) {
    if (!field.value) continue;
    const section = placement.get(field.fieldId) ?? field.section;
    const list = bySection.get(section) ?? [];
    list.push({ label: field.label, value: fieldValue(field) });
    bySection.set(section, list);
  }
  const isInvoice = snapshot.document.kind === "invoice";
  const isVoid = state.status === "void";
  return {
    snapshot,
    state,
    mode,
    kindLabel: isInvoice ? "Invoice" : "Quote",
    isInvoice,
    logoSrc: logoSrc === undefined ? logoUrl(snapshot.brandKit.logoKey) : logoSrc,
    sections: config.sections,
    fields: (section) => bySection.get(section) ?? [],
    banners: documentBanners(snapshot, state),
    showPaymentDetails: isInvoice && !isVoid && state.status !== "paid",
    isVoid,
    balance: Math.max(0, snapshot.totals.total - state.amountPaid),
    money: (minor) => money(minor, snapshot.document.currency),
  };
}
