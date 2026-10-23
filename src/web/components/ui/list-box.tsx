import { Check } from "lucide-react";
import {
  composeRenderProps,
  Header,
  type ListBoxItemProps,
  type ListBoxProps,
  ListBoxSection,
  type ListBoxSectionProps,
  ListBox as RACListBox,
  ListBoxItem as RACListBoxItem,
} from "react-aria-components";
import { cn, composeTailwind } from "./utils";

export function ListBox<T extends object>({ className, ...props }: ListBoxProps<T>) {
  return (
    <RACListBox
      {...props}
      className={composeTailwind(className, "max-h-72 overflow-auto p-1 outline-none")}
    />
  );
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
          "flex min-h-11 cursor-default items-center gap-2 rounded-small px-2.5 text-sm text-ink outline-none md:min-h-9",
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

export function ListBoxHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <Header
      {...props}
      className={cn("px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground", className)}
    />
  );
}

export function ListBoxSectionGroup<T extends object>({
  title,
  className,
  children,
  ...props
}: Omit<ListBoxSectionProps<T>, "children" | "items"> & {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <ListBoxSection {...props} className={cn("not-first:mt-1", className)}>
      {title ? <ListBoxHeader>{title}</ListBoxHeader> : null}
      {children}
    </ListBoxSection>
  );
}
