import type { ReactNode } from "react";
import { cn } from "./utils";

export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Removes the body padding, for a table or list that fills the card. */
  flush?: boolean;
}

/** A white card with a hairline border, a title row, and a body. */
export function Section({ title, description, actions, children, className, flush }: SectionProps) {
  return (
    <section
      className={cn(
        "rounded-card border border-border bg-background",
        flush && "overflow-hidden",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-row-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
          {description ? (
            <p className="m-0 text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className={flush ? undefined : "px-5 py-5"}>{children}</div>
    </section>
  );
}

/** A label and value pair for read-only details. */
export function DetailItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  );
}
