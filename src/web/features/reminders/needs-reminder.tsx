import { Link } from "@tanstack/react-router";
import { BellRing, Send } from "lucide-react";
import { reminderOffsetText } from "../../../shared/schemas/reminder";
import { Button } from "../../components/ui/button";
import { Pill } from "../../components/ui/pill";
import { Section } from "../../components/ui/section";
import { Skeleton } from "../../components/ui/skeleton";
import { toast } from "../../components/ui/toast";
import { formatMoney } from "../../lib/format";
import { useReminderSuggestions, useSendReminder } from "./queries";

/**
 * The "needs reminder" list for the dashboard (U18): open invoices in suggest mode whose
 * reminder step is due. Each row sends its reminder with one click (R21).
 */
export function NeedsReminderList({ className }: { className?: string }) {
  const suggestions = useReminderSuggestions();
  const send = useSendReminder();
  const items = suggestions.data ?? [];

  return (
    <Section
      title="Needs a reminder"
      description="Unpaid invoices whose reminder is due."
      flush
      className={className}
    >
      {suggestions.isPending ? (
        <div className="flex flex-col gap-2 p-5" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="m-0 flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
          <BellRing className="size-4" aria-hidden="true" />
          No reminders are due.
        </p>
      ) : (
        <ul
          aria-label="Invoices that need a reminder"
          className="m-0 list-none divide-y divide-row-border p-0"
        >
          {items.map((item) => {
            const pending = send.isPending && send.variables === item.documentId;
            return (
              <li key={item.documentId} className="flex items-center gap-3 px-5 py-3">
                <Link
                  to="/invoices/$documentId"
                  params={{ documentId: item.documentId }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 hover:underline"
                >
                  <span className="truncate text-sm font-medium text-ink">
                    {item.number ?? "Invoice"} · {item.clientName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {reminderOffsetText(item.offsetDays)}
                    {item.offsetDays > 0
                      ? ` · ${item.overdueSent} of ${item.overdueCap} overdue reminders sent`
                      : ""}
                  </span>
                </Link>
                <span className="hidden flex-col items-end gap-1 sm:flex">
                  <span className="figure text-sm">{formatMoney(item.balance, item.currency)}</span>
                  <Pill status={item.displayStatus} />
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  isPending={pending}
                  aria-label={`Send a reminder for ${item.number ?? "this invoice"}`}
                  onPress={() =>
                    send.mutate(item.documentId, {
                      onSuccess: () =>
                        toast({
                          title: `Reminder sent for ${item.number ?? "the invoice"}`,
                          tone: "success",
                        }),
                    })
                  }
                >
                  <Send className="size-4" aria-hidden="true" />
                  Send
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
