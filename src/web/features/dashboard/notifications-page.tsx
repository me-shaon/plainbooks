import { Bell } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { Segment, SegmentedControl } from "../../components/ui/segmented-control";
import { Skeleton } from "../../components/ui/skeleton";
import { NotificationRow } from "./notifications";
import { useDismissAllNotifications, useNotifications } from "./queries";

const PAGE_SIZE = 25;

/** Every notification, newest first, with the dismissed ones marked. */
export function NotificationsPage() {
  const [state, setState] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const list = useNotifications(state, page);
  const dismissAll = useDismissAllNotifications();
  const data = list.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Background events that need your attention."
        actions={
          <Button
            variant="secondary"
            isDisabled={!data || data.unreadCount === 0}
            isPending={dismissAll.isPending}
            onPress={() => dismissAll.mutate()}
          >
            Dismiss all
          </Button>
        }
      />
      <SegmentedControl
        aria-label="Show"
        selectedKey={state}
        onSelectionChange={(key) => {
          setState(key === "unread" ? "unread" : "all");
          setPage(1);
        }}
      >
        <Segment id="all">All</Segment>
        <Segment id="unread">Open</Segment>
      </SegmentedControl>
      {!data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={state === "unread" ? "No open notifications" : "No notifications yet"}
          description="Failed tasks, quote decisions, bounces, and recurring drafts show up here."
        />
      ) : (
        <ul
          aria-label="Notifications"
          className="m-0 list-none divide-y divide-row-border overflow-hidden rounded-card border border-border bg-background p-0"
        >
          {data.items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[13px] text-muted-foreground">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={page <= 1}
            onPress={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={page >= pages}
            onPress={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </>
  );
}
