import { todayIn } from "../../shared/time";
import type { Document } from "../db/schema";
import type { RenderState } from "./model";

/** The live state of a stored document, for banners and paid amounts. */
export function renderStateOf(
  doc: Pick<Document, "status" | "amountPaid" | "decidedAt" | "decisionComment">,
  timeZone: string,
  now: number,
): RenderState {
  return {
    status: doc.status,
    amountPaid: doc.amountPaid,
    today: todayIn(timeZone, now),
    timeZone,
    decidedAt: doc.decidedAt,
    decisionComment: doc.decisionComment,
  };
}

/** State for a preview that is not sent: a draft with no payments. */
export function previewState(timeZone: string, now: number): RenderState {
  return {
    status: "draft",
    amountPaid: 0,
    today: todayIn(timeZone, now),
    timeZone,
    decidedAt: null,
    decisionComment: null,
  };
}
