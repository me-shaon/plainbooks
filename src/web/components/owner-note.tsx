import { Lock } from "lucide-react";
import { cn } from "./ui/utils";

/** Tells a Member that only an Owner can change the settings on this page. */
export function OwnerOnlyNote({
  children = "Only an Owner can change these settings. You can view them.",
  className,
}: {
  children?: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "m-0 flex items-center gap-2 rounded-button border border-border bg-sidebar px-3.5 py-2.5 text-[13px] text-muted-foreground",
        className,
      )}
    >
      <Lock className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
      {children}
    </p>
  );
}
