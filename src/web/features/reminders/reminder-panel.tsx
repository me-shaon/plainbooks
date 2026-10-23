import { Send } from "lucide-react";
import { REMINDER_MODE_SETTINGS, type ReminderModeSetting } from "../../../shared/domain";
import { OWNER_ONLY_MESSAGE, REMINDER_MODE_LABELS } from "../../../shared/schemas/client";
import type { DocumentDetail } from "../../../shared/schemas/document";
import { reminderOffsetText } from "../../../shared/schemas/reminder";
import { Button } from "../../components/ui/button";
import { ListBoxItem } from "../../components/ui/list-box";
import { DetailItem, Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { toast } from "../../components/ui/toast";
import { useMe } from "../../lib/session";
import { formatTimestamp } from "../documents/labels";
import { useReminderStatus, useSendReminder, useSetReminderMode } from "./queries";

const MODE_TEXT = {
  suggest: "Suggested on the dashboard",
  auto_send: "Sent automatically",
  off: "Off",
} as const;

/** Reminder controls on an invoice: the mode override (with "off") and Send reminder. */
export function ReminderPanel({ document: doc }: { document: DocumentDetail }) {
  const { isOwner } = useMe();
  const open = doc.status === "sent" || doc.status === "partially_paid";
  const status = useReminderStatus(doc.id, doc.number !== null);
  const send = useSendReminder();
  const setMode = useSetReminderMode(doc.id);
  const locked = !isOwner && doc.reminderMode === "auto_send";
  const s = status.data;

  return (
    <Section
      title="Reminders"
      actions={
        open ? (
          <Button
            size="sm"
            variant="secondary"
            isDisabled={!s?.canSend}
            isPending={send.isPending}
            onPress={() =>
              send.mutate(doc.id, {
                onSuccess: () => toast({ title: "Reminder sent", tone: "success" }),
              })
            }
          >
            <Send className="size-4" aria-hidden="true" />
            Send reminder
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Reminders for this invoice"
          value={doc.reminderMode}
          isDisabled={locked || doc.status === "void" || setMode.isPending}
          disabledKeys={isOwner ? undefined : ["auto_send"]}
          onChange={(key) =>
            key && key !== doc.reminderMode && setMode.mutate(key as ReminderModeSetting)
          }
          description={
            isOwner
              ? "Off wins over the client and workspace settings."
              : locked
                ? OWNER_ONLY_MESSAGE
                : "Only an Owner can turn on auto-send"
          }
        >
          {REMINDER_MODE_SETTINGS.map((mode) => (
            <ListBoxItem key={mode} id={mode}>
              {REMINDER_MODE_LABELS[mode]}
            </ListBoxItem>
          ))}
        </Select>
        {status.isPending && doc.number !== null ? (
          <Skeleton className="h-16 w-full" />
        ) : s ? (
          <dl className="m-0 grid grid-cols-2 gap-3">
            <DetailItem label="Applies now">{MODE_TEXT[s.mode]}</DetailItem>
            <DetailItem label="Overdue reminders">
              <span className="figure">
                {s.overdueSent} of {s.overdueCap}
              </span>
            </DetailItem>
            {open && s.offsetDays !== null ? (
              <DetailItem label="Due">{reminderOffsetText(s.offsetDays)}</DetailItem>
            ) : null}
            {s.history[0] ? (
              <DetailItem label="Last reminder">{formatTimestamp(s.history[0].at)}</DetailItem>
            ) : null}
            {open && s.blockedReason ? (
              <p className="col-span-2 m-0 text-[13px] text-muted-foreground">{s.blockedReason}</p>
            ) : null}
          </dl>
        ) : null}
      </div>
    </Section>
  );
}
