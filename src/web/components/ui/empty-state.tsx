import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links, for example a primary "New invoice" button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card bg-card px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-10 items-center justify-center rounded-full bg-tint text-tint-foreground">
          <Icon className="size-5" strokeWidth={1.7} aria-hidden="true" />
        </span>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
        {description ? (
          <p className="m-0 text-[13px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
