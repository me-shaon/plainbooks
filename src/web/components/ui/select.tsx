import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as RACButton,
  Select as RACSelect,
  type SelectProps as RACSelectProps,
  SelectValue,
} from "react-aria-components";
import { Description, FieldError, type FieldTextProps, fieldStack, inputBox, Label } from "./field";
import { ListBox } from "./list-box";
import { Popover } from "./popover";
import { cn, composeTailwind } from "./utils";

export interface SelectProps<T extends object>
  extends Omit<RACSelectProps<T>, "children">,
    FieldTextProps {
  items?: Iterable<T>;
  children: ReactNode | ((item: T) => ReactNode);
}

/**
 * A select. Pass `ListBoxItem` children, or `items` with a render function.
 *
 * ```tsx
 * <Select label="Currency" value={currency} onChange={setCurrency}>
 *   <ListBoxItem id="USD">USD</ListBoxItem>
 * </Select>
 * ```
 */
export function Select<T extends object>({
  label,
  description,
  errorMessage,
  items,
  children,
  className,
  ...props
}: SelectProps<T>) {
  return (
    <RACSelect {...props} className={composeTailwind(className, fieldStack)}>
      {label ? <Label>{label}</Label> : null}
      <RACButton
        className={cn(
          inputBox,
          "flex items-center gap-2 text-left data-[focus-visible]:border-accent data-[focus-visible]:ring-3 data-[focus-visible]:ring-accent/20",
          "group-data-[invalid]:border-danger group-data-[disabled]:bg-sidebar group-data-[disabled]:text-muted-foreground",
        )}
      >
        <SelectValue className="flex-1 truncate data-[placeholder]:text-muted-foreground" />
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </RACButton>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover>
        <ListBox items={items}>{children}</ListBox>
      </Popover>
    </RACSelect>
  );
}
