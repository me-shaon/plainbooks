import type { ReactNode } from "react";
import {
  type FieldErrorProps,
  type LabelProps,
  FieldError as RACFieldError,
  Label as RACLabel,
  Text,
  type TextProps,
} from "react-aria-components";
import { cn, composeTailwind } from "./utils";

export function Label({ className, ...props }: LabelProps) {
  return (
    <RACLabel
      {...props}
      className={cn("w-fit text-[13px] font-medium text-ink cursor-default", className)}
    />
  );
}

export function Description({ className, ...props }: TextProps) {
  return (
    <Text
      {...props}
      slot="description"
      className={cn("text-xs text-muted-foreground", className)}
    />
  );
}

export function FieldError({ className, ...props }: FieldErrorProps) {
  return (
    <RACFieldError
      {...props}
      className={composeTailwind(className, "text-xs font-medium text-danger")}
    />
  );
}

/** The label, description, and error text shared by every form field. */
export interface FieldTextProps {
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: string | ((validation: { validationErrors: string[] }) => string);
}

/** Classes for the visible box of a text input. React Aria sets the data attributes. */
export const inputBox = cn(
  "min-h-11 w-full rounded-button border border-input bg-background px-3 text-sm text-ink md:min-h-10",
  "transition-[border-color,box-shadow] duration-(--duration-press)",
  "placeholder:text-muted-foreground",
  "outline-none data-[focused]:border-accent data-[focused]:ring-3 data-[focused]:ring-accent/20",
  "data-[focus-within]:border-accent data-[focus-within]:ring-3 data-[focus-within]:ring-accent/20",
  "data-[invalid]:border-danger data-[invalid]:data-[focused]:ring-danger/20",
  "data-[disabled]:cursor-not-allowed data-[disabled]:bg-sidebar data-[disabled]:text-muted-foreground",
);

export const fieldStack = "group flex flex-col gap-1.5";
