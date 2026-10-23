import type { ReactNode } from "react";
import { cn } from "./ui/utils";

export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  /** The hero card has the accent fill and white text. Use it for the first card only. */
  variant?: "hero" | "default";
  className?: string;
}

export function KpiCard({ label, value, note, variant = "default", className }: KpiCardProps) {
  const hero = variant === "hero";
  // On the accent fill, 80% white text is 3.7:1. Full white is 4.8:1, so the notes use it.
  const sub = hero ? "text-accent-foreground" : "text-muted-foreground";
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-card border px-[18px] py-4",
        hero
          ? "border-accent bg-accent text-accent-foreground"
          : "border-transparent bg-card text-ink",
        className,
      )}
    >
      <span className={cn("text-[13px]", sub)}>{label}</span>
      <span className="figure text-2xl leading-tight font-medium tracking-[-0.02em]">{value}</span>
      {note ? <span className={cn("text-xs", sub)}>{note}</span> : null}
    </div>
  );
}

/** The responsive row of KPI cards (4 across on wide screens, 1 on phones). */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      aria-label="Totals"
      className={cn("grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3", className)}
    >
      {children}
    </section>
  );
}
