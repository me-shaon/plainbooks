import { Check } from "lucide-react";
import {
  composeRenderProps,
  type ListBoxItemProps,
  type ListBoxProps,
  ListBox as RACListBox,
  ListBoxItem as RACListBoxItem,
} from "react-aria-components";
import { cn, composeTailwind } from "./utils";

/** The popover around a ListBox scrolls, so the list itself never adds a second scroll bar. */
export function ListBox<T extends object>({ className, ...props }: ListBoxProps<T>) {
  return <RACListBox {...props} className={composeTailwind(className, "p-1 outline-none")} />;
}

/** One option in a Select, ComboBox, or ListBox. */
export function ListBoxItem({ className, ...props }: ListBoxItemProps) {
  const textValue =
    props.textValue ?? (typeof props.children === "string" ? props.children : undefined);
  return (
    <RACListBoxItem
      {...props}
      textValue={textValue}
      className={composeTailwind(className, (rp) =>
        cn(
          "flex min-h-11 cursor-default items-center gap-2 rounded-small px-2.5 py-1.5 text-sm text-ink outline-none md:min-h-9",
          rp.isFocused && "bg-segmented",
          rp.isDisabled && "cursor-not-allowed text-muted-foreground opacity-60",
        ),
      )}
    >
      {composeRenderProps(props.children, (children, { isSelected }) => (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
          {isSelected ? <Check className="size-4 text-accent" aria-hidden="true" /> : null}
        </>
      ))}
    </RACListBoxItem>
  );
}
