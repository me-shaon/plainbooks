import { cn } from "./utils";

/** A placeholder block while data loads. Set the size with classes. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("motion-skeleton rounded-small bg-skeleton", className)}
    />
  );
}
