/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Fields } from "./fields";

export function NotesSection({ view }: { view: DocumentView }) {
  const notes = view.snapshot.document.notes;
  const fields = view.fields("notes");
  if (!notes && fields.length === 0) return null;
  return (
    <section class="sec sec-notes notes" aria-label="Notes">
      <span class="label">Notes</span>
      {notes ? <p class="pre small flush">{notes}</p> : null}
      <Fields items={fields} />
    </section>
  );
}
