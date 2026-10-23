import type { ReactNode } from "react";
import { SwitchButton, SwitchField, type SwitchFieldProps } from "react-aria-components";
import { Description } from "./field";
import { cn, composeTailwind } from "./utils";

export interface SwitchProps extends Omit<SwitchFieldProps, "children"> {
  children?: ReactNode;
  description?: ReactNode;
}

export function Switch({ children, description, className, ...props }: SwitchProps) {
  return (
    <SwitchField {...props} className={composeTailwind(className, "flex flex-col gap-1")}>
      <SwitchButton className="group flex min-h-11 w-fit items-center gap-2.5 text-sm text-ink outline-none data-[disabled]:opacity-50 md:min-h-8">
        {({ isSelected, isFocusVisible }) => (
          <>
            <span
              className={cn(
                "flex h-5 w-9 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-(--duration-press)",
                isSelected ? "bg-accent" : "bg-[#cfd4d0]",
                isFocusVisible && "outline-2 outline-offset-2 outline-ring",
              )}
            >
              <span
                className={cn(
                  "size-4 rounded-full bg-white shadow-segment transition-transform duration-(--duration-enter) ease-calm",
                  isSelected && "translate-x-4",
                )}
              />
            </span>
            {children}
          </>
        )}
      </SwitchButton>
      {description ? <Description className="pl-11.5">{description}</Description> : null}
    </SwitchField>
  );
}
