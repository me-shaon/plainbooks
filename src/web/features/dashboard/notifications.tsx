import { Link } from "@tanstack/react-router";
import { Bell, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { FailedJobView, NotificationView } from "../../../shared/schemas/dashboard";
import { jobTypeLabel } from "../../../shared/schemas/dashboard";
import { OwnerOnlyNote } from "../../components/owner-note";
import { Button } from "../../components/ui/button";
import { Section } from "../../components/ui/section";
import { toast } from "../../components/ui/toast";
import { useMe } from "../../lib/session";
import { documentPath, formatTimestamp } from "../documents/labels";
import { useDismissNotification, useRetryJob } from "./queries";

/** One notification row with a link to its document and a dismiss button. */
export function NotificationRow({ item }: { item: NotificationView }) {
  const dismiss = useDismissNotification();
  const dismissed = item.readAt !== null;
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {item.documentId && item.documentKind ? (
          <Link
            to={documentPath(item.documentKind)}
            params={{ documentId: item.documentId }}
            className="text-sm font-medium text-ink hover:underline"
          >
            {item.title}
          </Link>
        ) : (
          <span className="text-sm font-medium text-ink">{item.title}</span>
        )}
        {item.body ? (
          <span className="text-xs break-words text-muted-foreground">{item.body}</span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(item.createdAt)}
          {dismissed ? " · Dismissed" : ""}
        </span>
      </div>
      {dismissed ? null : (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Dismiss "${item.title}"`}
          isPending={dismiss.isPending}
          onPress={() => dismiss.mutate(item.id)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

/** The newest open notifications, with a link to the full list. */
export function NotificationsPanel({
  items,
  unreadCount,
  className,
}: {
  items: NotificationView[];
  unreadCount: number;
  className?: string;
}) {
  return (
    <Section
      title="Notifications"
      description={unreadCount > 0 ? `${unreadCount} open` : undefined}
      flush
      className={className}
      actions={
        <Link
          to="/notifications"
          className="text-[13px] font-medium text-tint-foreground hover:underline"
        >
          View all
        </Link>
      }
    >
      {items.length === 0 ? (
        <p className="m-0 flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
          <Bell className="size-4" aria-hidden="true" />
          You are up to date.
        </p>
      ) : (
        <ul aria-label="Notifications" className="m-0 list-none divide-y divide-row-border p-0">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Background jobs that ran out of attempts. Owners can put them back in the queue. */
export function FailedJobsPanel({
  items,
  count,
  className,
}: {
  items: FailedJobView[];
  count: number;
  className?: string;
}) {
  const { isOwner } = useMe();
  const retry = useRetryJob();
  return (
    <Section
      title="Failed background tasks"
      description={`${count} ${count === 1 ? "task" : "tasks"} stopped after the last attempt.`}
      flush
      className={className}
    >
      {isOwner ? null : (
        <div className="px-5 pt-4">
          <OwnerOnlyNote>Only an Owner can retry a task.</OwnerOnlyNote>
        </div>
      )}
      <ul aria-label="Failed tasks" className="m-0 list-none divide-y divide-row-border p-0">
        {items.map((job) => (
          <li key={job.id} className="flex items-start gap-3 px-5 py-3">
            <TriangleAlert className="mt-0.5 size-4 text-danger" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{jobTypeLabel(job.type)}</span>
              {job.lastError ? (
                <span className="text-xs break-words text-muted-foreground">{job.lastError}</span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}
                {job.finishedAt ? ` · ${formatTimestamp(job.finishedAt)}` : ""}
              </span>
            </div>
            {isOwner ? (
              <Button
                size="sm"
                variant="secondary"
                isPending={retry.isPending && retry.variables === job.id}
                onPress={() =>
                  retry.mutate(job.id, {
                    onSuccess: () => toast({ title: "The task is queued again", tone: "success" }),
                  })
                }
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Retry
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
