import type { Key } from "react-aria-components";
import {
  ToggleButton,
  ToggleButtonGroup,
  type ToggleButtonGroupProps,
  type ToggleButtonProps,
} from "react-aria-components";
import { cn, composeTailwind } from "./utils";

export interface SegmentedControlProps
  extends Omit<
    ToggleButtonGroupProps,
    "selectionMode" | "selectedKeys" | "defaultSelectedKeys" | "onSelectionChange"
  > {
  selectedKey?: Key;
  defaultSelectedKey?: Key;
  onSelectionChange?: (key: Key) => void;
}

/**
 * A row of mutually exclusive options, such as a filter. Exactly one segment is selected.
 *
 * ```tsx
 * <SegmentedControl aria-label="Filter" selectedKey={filter} onSelectionChange={setFilter}>
 *   <Segment id="all">All</Segment>
 *   <Segment id="unpaid">Unpaid</Segment>
 * </SegmentedControl>
 * ```
 */
export function SegmentedControl({
  selectedKey,
  defaultSelectedKey,
  onSelectionChange,
  className,
  ...props
}: SegmentedControlProps) {
  return (
    <ToggleButtonGroup
      {...props}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={selectedKey === undefined ? undefined : [selectedKey]}
      defaultSelectedKeys={defaultSelectedKey === undefined ? undefined : [defaultSelectedKey]}
      onSelectionChange={(keys) => {
        const [first] = keys;
        if (first !== undefined) onSelectionChange?.(first);
      }}
      className={composeTailwind(
        className,
        "inline-flex max-w-full gap-1 overflow-x-auto rounded-button bg-segmented p-[3px]",
      )}
    />
  );
}

export function Segment({ className, ...props }: ToggleButtonProps) {
  return (
    <ToggleButton
      {...props}
      className={composeTailwind(className, (rp) =>
        cn(
          "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-small px-3 text-[13px] whitespace-nowrap outline-none md:min-h-[30px]",
          "transition-[background-color,color,box-shadow] duration-(--duration-press)",
          rp.isSelected
            ? "bg-background font-medium text-ink shadow-segment"
            : "bg-transparent text-muted-foreground hover:text-ink",
          rp.isFocusVisible && "outline-2 outline-offset-1 outline-ring",
          rp.isDisabled && "opacity-50",
        ),
      )}
    />
  );
}
