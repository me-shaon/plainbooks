import { composeRenderProps } from "react-aria-components";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["card", "button", "small", "pill"],
      shadow: ["raised", "segment", "popover"],
    },
  },
});

type ClassValue = string | false | null | undefined;

/** Joins class names and resolves Tailwind conflicts (the last class wins). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(classes.filter(Boolean).join(" "));
}

/**
 * Merges a component's base classes with a caller's `className`. The caller's value can be a
 * string or a React Aria render-props function.
 */
export function composeTailwind<T>(
  className: string | ((renderProps: T) => string) | undefined,
  base: string | ((renderProps: T) => string),
): (renderProps: T) => string {
  return composeRenderProps(className, (callerClass, renderProps) =>
    cn(typeof base === "function" ? base(renderProps) : base, callerClass),
  );
}

/** A visible focus ring for keyboard focus. */
export const focusRing =
  "outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ring";
