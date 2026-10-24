import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "./utils";

/**
 * The phone layout of a table: one stacked row per item. Show it below 768 px and the
 * table above, for example `<StackedList className="md:hidden">` next to
 * `<TableContainer className="hidden md:block">`.
 */
export function StackedList({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "m-0 list-none divide-y divide-row-border overflow-hidden rounded-card border border-border bg-background p-0",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export interface StackedRowProps {
  /** The main line, for example the client name. */
  title: ReactNode;
  /** Smaller text under the title. */
  meta?: ReactNode;
  /** Right-aligned value, for example an amount. */
  value?: ReactNode;
  /** Controls at the end of the row, for example a menu button. */
  actions?: ReactNode;
  /** Makes the row a link. */
  to?: LinkProps["to"];
  params?: LinkProps["params"];
}

export function StackedRow({ title, meta, value, actions, to, params }: StackedRowProps) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-ink">{title}</span>
        {meta ? <span className="truncate text-[13px] text-muted-foreground">{meta}</span> : null}
      </div>
      {value ? <div className="shrink-0 text-right text-sm">{value}</div> : null}
    </>
  );
  const rowClass = "flex min-h-14 items-center gap-3 px-[18px] py-3";
  return (
    <li className="flex items-center">
      {to ? (
        <Link
          to={to}
          params={params}
          className={cn(
            rowClass,
            "min-w-0 flex-1 outline-none hover:bg-sidebar focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={cn(rowClass, "min-w-0 flex-1")}>{body}</div>
      )}
      {actions ? <div className="shrink-0 pr-2">{actions}</div> : null}
    </li>
  );
}
