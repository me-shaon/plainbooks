import { Check } from "lucide-react";
import {
  composeRenderProps,
  type MenuItemProps,
  type PopoverProps,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  type MenuProps as RACMenuProps,
  Separator,
} from "react-aria-components";
import { Popover } from "./popover";
import { cn, composeTailwind } from "./utils";

export { MenuTrigger, SubmenuTrigger } from "react-aria-components";

export interface MenuProps<T extends object> extends RACMenuProps<T> {
  placement?: PopoverProps["placement"];
}

/**
 * A menu in a popover. Use it inside a `MenuTrigger` after the trigger button.
 *
 * ```tsx
 * <MenuTrigger>
 *   <Button variant="ghost" size="icon" aria-label="More"><Ellipsis /></Button>
 *   <Menu><MenuItem onAction={...}>Duplicate</MenuItem></Menu>
 * </MenuTrigger>
 * ```
 */
export function Menu<T extends object>({
  placement = "bottom end",
  className,
  ...props
}: MenuProps<T>) {
  return (
    <Popover placement={placement} className="min-w-44">
      <RACMenu {...props} className={composeTailwind(className, "p-1 outline-none")} />
    </Popover>
  );
}

export interface MenuItemStyleProps extends MenuItemProps {
  variant?: "default" | "danger";
}

export function MenuItem({ variant = "default", className, ...props }: MenuItemStyleProps) {
  const textValue =
    props.textValue ?? (typeof props.children === "string" ? props.children : undefined);
  return (
    <RACMenuItem
      {...props}
      textValue={textValue}
      className={composeTailwind(className, (rp) =>
        cn(
          "flex min-h-11 cursor-default items-center gap-2 rounded-small px-2.5 text-sm outline-none md:min-h-9 [&_svg]:size-4 [&_svg]:shrink-0",
          variant === "danger" ? "text-danger" : "text-ink",
          rp.isFocused && (variant === "danger" ? "bg-danger-tint" : "bg-segmented"),
          rp.isDisabled && "cursor-not-allowed opacity-50",
        ),
      )}
    >
      {composeRenderProps(props.children, (children, { selectionMode, isSelected }) => (
        <>
          {selectionMode !== "none" ? (
            <span className="flex w-4 items-center">
              {isSelected ? <Check aria-hidden="true" /> : null}
            </span>
          ) : null}
          <span className="flex flex-1 items-center gap-2">{children}</span>
        </>
      ))}
    </RACMenuItem>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <Separator className={cn("mx-1 my-1 h-px bg-border", className)} />;
}
