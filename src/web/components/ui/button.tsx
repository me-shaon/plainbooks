import { LoaderCircle } from "lucide-react";
import {
  composeRenderProps,
  Button as RACButton,
  type ButtonProps as RACButtonProps,
} from "react-aria-components";
import { cn, composeTailwind, focusRing } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<ButtonVariant, string> = {
  // Ink fill with white text (the Final design's primary button).
  primary: "bg-ink text-ink-foreground hover:bg-[#2c312e] pressed:bg-[#0d0f0e]",
  // White fill with a hairline outline.
  secondary: "border border-border bg-background text-ink hover:bg-sidebar pressed:bg-segmented",
  ghost: "bg-transparent text-ink hover:bg-segmented pressed:bg-[#e6e9e6]",
  danger: "bg-danger text-danger-foreground hover:bg-danger-strong pressed:bg-[#7a2a14]",
};

// Below 768 px every size is at least 44 px tall so it is easy to tap.
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-11 gap-1.5 px-3 text-[13px] md:min-h-8",
  md: "min-h-11 gap-2 px-4 md:min-h-10",
  lg: "min-h-11 gap-2 px-5 text-[15px] md:min-h-11",
  icon: "size-11 md:size-10",
  "icon-sm": "size-11 md:size-8",
};

export interface ButtonProps extends RACButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "relative inline-flex shrink-0 select-none items-center justify-center rounded-button font-medium whitespace-nowrap",
    "transition-[background-color,box-shadow,transform] duration-(--duration-press) ease-calm",
    "pressed:scale-[0.98] disabled:opacity-50 disabled:pressed:scale-100 [&_svg]:shrink-0",
    focusRing,
    variants[variant],
    sizes[size],
    className,
  );
}

/** A native `button` built on React Aria. Use `onPress`, not `onClick`. */
export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <RACButton
      {...props}
      className={composeTailwind(className, (rp) =>
        cn(buttonStyles({ variant, size }), rp.isPending && "text-transparent"),
      )}
    >
      {composeRenderProps(props.children, (children, { isPending }) => (
        <>
          {children}
          {isPending ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-0 flex items-center justify-center",
                variant === "primary" || variant === "danger" ? "text-white" : "text-ink",
              )}
            >
              <LoaderCircle className="size-4 animate-spin" />
            </span>
          ) : null}
        </>
      ))}
    </RACButton>
  );
}
