import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { CheckboxButton, CheckboxField, type CheckboxFieldProps } from "react-aria-components";
import { Description, FieldError } from "./field";
import { cn, composeTailwind } from "./utils";

export interface CheckboxProps extends Omit<CheckboxFieldProps, "children"> {
  children?: ReactNode;
  description?: ReactNode;
  errorMessage?: string;
}

export function Checkbox({
  children,
  description,
  errorMessage,
  className,
  ...props
}: CheckboxProps) {
  return (
    <CheckboxField {...props} className={composeTailwind(className, "flex flex-col gap-1")}>
      <CheckboxButton className="group flex min-h-11 w-fit items-center gap-2.5 text-sm text-ink outline-none data-[disabled]:opacity-50 md:min-h-8">
        {({ isSelected, isIndeterminate, isFocusVisible, isInvalid }) => (
          <>
            <span
              className={cn(
                "flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-(--duration-press)",
                isSelected || isIndeterminate
                  ? "border-ink bg-ink text-ink-foreground"
                  : "border-input bg-background group-hover:border-muted-foreground",
                isInvalid && "border-danger",
                isFocusVisible && "outline-2 outline-offset-2 outline-ring",
              )}
            >
              {isIndeterminate ? (
                <Minus className="size-3" strokeWidth={3} aria-hidden="true" />
              ) : isSelected ? (
                <Check className="size-3" strokeWidth={3} aria-hidden="true" />
              ) : null}
            </span>
            {children}
          </>
        )}
      </CheckboxButton>
      {description ? <Description className="pl-7">{description}</Description> : null}
      <FieldError className="pl-7">{errorMessage}</FieldError>
    </CheckboxField>
  );
}
