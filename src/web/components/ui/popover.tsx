import { type PopoverProps, Popover as RACPopover } from "react-aria-components";
import { composeTailwind } from "./utils";

/** A floating panel for menus, list boxes, and the date picker calendar. */
export function Popover({ className, offset = 6, ...props }: PopoverProps) {
  return (
    <RACPopover
      offset={offset}
      {...props}
      className={composeTailwind(
        className,
        "motion-pop min-w-(--trigger-width) overflow-auto rounded-card bg-background shadow-popover outline-none",
      )}
    />
  );
}
