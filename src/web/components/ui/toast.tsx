import { CircleAlert, CircleCheck, X } from "lucide-react";
import {
  Button as RACButton,
  UNSTABLE_Toast as RACToast,
  UNSTABLE_ToastContent as RACToastContent,
  UNSTABLE_ToastQueue as RACToastQueue,
  UNSTABLE_ToastRegion as RACToastRegion,
  Text,
} from "react-aria-components";
import { cn, focusRing } from "./utils";

export interface ToastContent {
  title: string;
  description?: string;
  tone?: "neutral" | "success" | "danger";
}

/** The app-wide toast queue. `<Toaster />` in the root layout renders it. */
export const toastQueue = new RACToastQueue<ToastContent>({ maxVisibleToasts: 3 });

/**
 * Shows a toast. It closes after 5 s unless the tone is "danger" (those stay until closed).
 *
 * ```ts
 * toast({ title: "Invoice sent", tone: "success" });
 * ```
 */
export function toast(content: ToastContent, options?: { timeout?: number; onClose?: () => void }) {
  const timeout = options?.timeout ?? (content.tone === "danger" ? undefined : 5000);
  return toastQueue.add(content, { ...options, timeout });
}

export function Toaster() {
  return (
    <RACToastRegion
      queue={toastQueue}
      className="fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 outline-none sm:left-auto"
    >
      {({ toast: queued }) => {
        const { title, description, tone = "neutral" } = queued.content;
        const Icon = tone === "danger" ? CircleAlert : tone === "success" ? CircleCheck : null;
        return (
          <RACToast
            toast={queued}
            className={cn(
              "motion-toast flex w-full items-start gap-3 rounded-card bg-ink px-4 py-3 text-ink-foreground shadow-popover sm:w-[360px]",
              focusRing,
            )}
          >
            {Icon ? (
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  tone === "danger" ? "text-[#f4b4a0]" : "text-accent-mid",
                )}
              />
            ) : null}
            <RACToastContent className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Text slot="title" className="text-sm font-medium">
                {title}
              </Text>
              {description ? (
                <Text slot="description" className="text-[13px] text-white/80">
                  {description}
                </Text>
              ) : null}
            </RACToastContent>
            <RACButton
              slot="close"
              aria-label="Close"
              className={cn(
                "-mt-1 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-small text-white/80 hover:bg-white/10 hover:text-white",
                focusRing,
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </RACButton>
          </RACToast>
        );
      }}
    </RACToastRegion>
  );
}
