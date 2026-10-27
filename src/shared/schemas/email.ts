// Send dialog validation, shared by the API and the send dialog (U9).
import { z } from "zod";

export const MAX_RECIPIENTS = 20;

export const recipientList = z
  .array(z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")))
  .min(1, "Add at least one recipient")
  .max(MAX_RECIPIENTS, `Add ${MAX_RECIPIENTS} recipients or fewer`)
  .transform((list) => [...new Set(list)]);

/** POST /api/documents/:id/send. Omitted recipients default to the client's contacts. */
export const sendDocumentInput = z.object({
  recipients: recipientList.optional(),
  subject: z.string().trim().max(200, "Use 200 characters or fewer").nullish(),
  message: z.string().trim().max(5000, "Use 5000 characters or fewer").nullish(),
});
export type SendDocumentInput = z.output<typeof sendDocumentInput>;
