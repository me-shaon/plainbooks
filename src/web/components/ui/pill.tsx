import type { ReactNode } from "react";
import { STATUS_LABELS, type Status } from "./status";
import { cn } from "./utils";

// Literal class names, so Tailwind finds them when it scans the source.
const pillClasses: Record<Status, string> = {
  draft: "bg-pill-draft text-pill-draft-foreground",
  finalized: "bg-pill-finalized text-pill-finalized-foreground",
  sent: "bg-pill-sent text-pill-sent-foreground",
  paid: "bg-pill-paid text-pill-paid-foreground",
  partially_paid: "bg-pill-partially-paid text-pill-partially-paid-foreground",
  overdue: "bg-pill-overdue text-pill-overdue-foreground",
  void: "bg-pill-void text-pill-void-foreground",
  accepted: "bg-pill-accepted text-pill-accepted-foreground",
  declined: "bg-pill-declined text-pill-declined-foreground",
  expired: "bg-pill-expired text-pill-expired-foreground",
  converted: "bg-pill-converted text-pill-converted-foreground",
};

export interface PillProps {
  status: Status;
  /** Overrides the default label, for example "Overdue 11 days". */
  children?: ReactNode;
  className?: string;
}

/** A status badge. Each status has its own color pair. */
export function Pill({ status, children, className }: PillProps) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-pill px-[9px] py-[3px] text-xs leading-[1.4] font-medium whitespace-nowrap",
        pillClasses[status],
        className,
      )}
    >
      {children ?? STATUS_LABELS[status]}
    </span>
  );
}

export { Pill as StatusBadge };
