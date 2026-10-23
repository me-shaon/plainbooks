import {
  OverlayArrow,
  Tooltip as RACTooltip,
  type TooltipProps as RACTooltipProps,
} from "react-aria-components";
import { composeTailwind } from "./utils";

export { TooltipTrigger } from "react-aria-components";

export interface TooltipProps extends Omit<RACTooltipProps, "children"> {
  children: React.ReactNode;
}

/**
 * A short label shown on hover or keyboard focus.
 *
 * ```tsx
 * <TooltipTrigger><Button aria-label="Copy link"><Link2 /></Button><Tooltip>Copy link</Tooltip></TooltipTrigger>
 * ```
 */
export function Tooltip({ children, className, offset = 8, ...props }: TooltipProps) {
  return (
    <RACTooltip
      {...props}
      offset={offset}
      className={composeTailwind(
        className,
        "motion-fade group max-w-64 rounded-small bg-ink px-2.5 py-1.5 text-xs text-ink-foreground shadow-popover",
      )}
    >
      <OverlayArrow>
        <svg
          width={8}
          height={8}
          viewBox="0 0 8 8"
          aria-hidden="true"
          className="fill-ink group-data-[placement=bottom]:rotate-180 group-data-[placement=left]:-rotate-90 group-data-[placement=right]:rotate-90"
        >
          <path d="M0 0 L4 4 L8 0" />
        </svg>
      </OverlayArrow>
      {children}
    </RACTooltip>
  );
}
