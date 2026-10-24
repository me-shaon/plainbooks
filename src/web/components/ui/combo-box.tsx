import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Group,
  Input,
  Button as RACButton,
  ComboBox as RACComboBox,
  type ComboBoxProps as RACComboBoxProps,
} from "react-aria-components";
import { Description, FieldError, type FieldTextProps, fieldStack, inputBox, Label } from "./field";
import { ListBox } from "./list-box";
import { Popover } from "./popover";
import { cn, composeTailwind } from "./utils";

export interface ComboBoxProps<T extends object>
  extends Omit<RACComboBoxProps<T>, "children">,
    FieldTextProps {
  placeholder?: string;
  children: ReactNode | ((item: T) => ReactNode);
}

/** A text input with a filtered list of options. Pass `ListBoxItem` children. */
export function ComboBox<T extends object>({
  label,
  description,
  errorMessage,
  placeholder,
  items,
  children,
  className,
  ...props
}: ComboBoxProps<T>) {
  return (
    <RACComboBox {...props} items={items} className={composeTailwind(className, fieldStack)}>
      {label ? <Label>{label}</Label> : null}
      <Group className={cn(inputBox, "flex items-center px-0")}>
        <Input
          placeholder={placeholder}
          className="min-w-0 flex-1 self-stretch bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <RACButton className="flex w-10 shrink-0 items-center justify-center self-stretch text-muted-foreground outline-none">
          <ChevronDown className="size-4" aria-hidden="true" />
        </RACButton>
      </Group>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover maxHeight={288}>
        <ListBox<T>>{children}</ListBox>
      </Popover>
    </RACComboBox>
  );
}
