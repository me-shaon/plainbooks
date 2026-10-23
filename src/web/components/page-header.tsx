import type { ReactNode } from "react";
import { cn } from "./ui/utils";

export interface PageHeaderProps {
  title: ReactNode;
  /** Small text above the title, for example today's date. */
  eyebrow?: ReactNode;
  /** Text below the title. */
  subtitle?: ReactNode;
  /** Buttons on the right. They wrap below the title on narrow screens. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, eyebrow, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <span className="text-[13px] text-muted-foreground">{eyebrow}</span> : null}
        <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle ? <p className="m-0 text-[13px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
