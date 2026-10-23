import { X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Heading,
  ModalOverlay,
  type ModalOverlayProps,
  Button as RACButton,
  Dialog as RACDialog,
  type DialogProps as RACDialogProps,
  Modal as RACModal,
} from "react-aria-components";
import { Button } from "./button";
import { cn, focusRing } from "./utils";

export { DialogTrigger } from "react-aria-components";

export interface ModalProps extends Omit<ModalOverlayProps, "className" | "children"> {
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const modalSizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

/** The overlay and centered panel. Put a `Dialog` or `AlertDialog` inside. */
export function Modal({
  children,
  size = "md",
  className,
  isDismissable = true,
  ...props
}: ModalProps) {
  return (
    <ModalOverlay
      {...props}
      isDismissable={isDismissable}
      className="motion-fade fixed inset-0 z-50 flex items-end justify-center bg-[rgb(23_26_24/0.32)] p-0 sm:items-center sm:p-4"
    >
      <RACModal
        className={cn(
          "motion-pop max-h-[calc(100dvh-2rem)] w-full overflow-auto rounded-t-card bg-background shadow-popover outline-none sm:rounded-card",
          modalSizes[size],
          className,
        )}
      >
        {children}
      </RACModal>
    </ModalOverlay>
  );
}

export interface DialogProps extends Omit<RACDialogProps, "children"> {
  title?: ReactNode;
  description?: ReactNode;
  /** Shows a close button in the corner. On by default. */
  showClose?: boolean;
  /** Buttons for the footer. */
  footer?: ReactNode | ((close: () => void) => ReactNode);
  children?: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A dialog panel with a title, body, and footer. Focus stays inside until it closes.
 *
 * ```tsx
 * <DialogTrigger>
 *   <Button>Edit</Button>
 *   <Modal><Dialog title="Edit client">...</Dialog></Modal>
 * </DialogTrigger>
 * ```
 */
export function Dialog({
  title,
  description,
  showClose = true,
  footer,
  children,
  className,
  ...props
}: DialogProps) {
  return (
    <RACDialog {...props} className={cn("relative flex flex-col outline-none", className)}>
      {({ close }) => (
        <>
          {title ? (
            <div className="flex flex-col gap-1 px-6 pt-5 pb-2 pr-14">
              <Heading slot="title" className="m-0 text-[17px] font-semibold tracking-[-0.01em]">
                {title}
              </Heading>
              {description ? (
                <p className="m-0 text-[13px] text-muted-foreground">{description}</p>
              ) : null}
            </div>
          ) : null}
          {showClose ? (
            <RACButton
              slot="close"
              aria-label="Close"
              className={cn(
                "absolute top-3 right-3 flex size-11 items-center justify-center rounded-small text-muted-foreground hover:bg-segmented hover:text-ink md:size-9",
                focusRing,
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </RACButton>
          ) : null}
          <div className="px-6 py-3">
            {typeof children === "function" ? children(close) : children}
          </div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 px-6 pt-2 pb-5 sm:flex-row sm:justify-end">
              {typeof footer === "function" ? footer(close) : footer}
            </div>
          ) : null}
        </>
      )}
    </RACDialog>
  );
}

export interface AlertDialogProps extends Omit<ModalOverlayProps, "children" | "className"> {
  title: ReactNode;
  children: ReactNode;
  actionLabel: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onAction?: () => void;
}

/**
 * A confirmation dialog with `role="alertdialog"`. Escape cancels. A click outside does not.
 * Use it inside a `DialogTrigger`, or control it with `isOpen` and `onOpenChange`.
 */
export function AlertDialog({
  title,
  children,
  actionLabel,
  cancelLabel = "Cancel",
  variant = "default",
  onAction,
  ...props
}: AlertDialogProps) {
  return (
    <Modal {...props} isDismissable={false} size="sm">
      <Dialog
        role="alertdialog"
        title={title}
        showClose={false}
        footer={(close) => (
          <>
            <Button variant="secondary" onPress={close}>
              {cancelLabel}
            </Button>
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              autoFocus
              onPress={() => {
                onAction?.();
                close();
              }}
            >
              {actionLabel}
            </Button>
          </>
        )}
      >
        <div className="text-sm text-muted-foreground">{children}</div>
      </Dialog>
    </Modal>
  );
}
