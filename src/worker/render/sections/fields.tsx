/** @jsxImportSource hono/jsx */
import type { FieldView } from "../model";

/** Custom fields of one section. Renders nothing when the list is empty. */
export function Fields({ items, className }: { items: FieldView[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <dl class={className ? `fields ${className}` : "fields"}>
      {items.map((field) => (
        <>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </>
      ))}
    </dl>
  );
}
