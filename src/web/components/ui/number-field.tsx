import { Minus, Plus } from "lucide-react";
import {
  Group,
  Input,
  Button as RACButton,
  NumberField as RACNumberField,
  type NumberFieldProps as RACNumberFieldProps,
} from "react-aria-components";
import { Description, FieldError, type FieldTextProps, fieldStack, inputBox, Label } from "./field";
import { cn, composeTailwind, focusRing } from "./utils";

export interface NumberFieldProps extends RACNumberFieldProps, FieldTextProps {
  placeholder?: string;
  /** Shows minus and plus buttons. Off by default, because money fields do not need them. */
  showStepper?: boolean;
  inputClassName?: string;
}

const stepButton = cn(
  "flex size-9 shrink-0 items-center justify-center rounded-small text-muted-foreground md:size-8",
  "hover:bg-segmented hover:text-ink pressed:bg-[#e6e9e6] disabled:opacity-40",
  focusRing,
);

/** A number input. Numbers use the mono font with tabular figures. */
export function NumberField({
  label,
  description,
  errorMessage,
  placeholder,
  showStepper = false,
  inputClassName,
  className,
  ...props
}: NumberFieldProps) {
  return (
    <RACNumberField {...props} className={composeTailwind(className, fieldStack)}>
      {label ? <Label>{label}</Label> : null}
      <Group className={cn(inputBox, "flex items-center gap-1 px-0 pr-1")}>
        <Input
          placeholder={placeholder}
          className={cn(
            "figure min-w-0 flex-1 self-stretch bg-transparent px-3 text-sm outline-none",
            inputClassName,
          )}
        />
        {showStepper ? (
          <>
            <RACButton slot="decrement" className={stepButton}>
              <Minus className="size-3.5" aria-hidden="true" />
            </RACButton>
            <RACButton slot="increment" className={stepButton}>
              <Plus className="size-3.5" aria-hidden="true" />
            </RACButton>
          </>
        ) : null}
      </Group>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </RACNumberField>
  );
}
