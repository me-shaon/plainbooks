import type { ActivityEntry } from "../../../shared/schemas/document";
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../components/ui/utils";
import { activityText, formatTimestamp } from "./labels";

const DANGER_TYPES = new Set(["send_failed", "email_bounced", "email_complained", "voided"]);

/** The activity history, newest first. The dashboard can reuse it for a feed. */
export function ActivityTimeline({
  items,
  currency,
  isPending,
}: {
  items: ActivityEntry[] | undefined;
  currency: string;
  isPending?: boolean;
}) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (!items || items.length === 0) {
    return <p className="m-0 text-[13px] text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ol aria-label="Activity" className="m-0 flex list-none flex-col p-0">
      {items.map((entry, index) => {
        const { title, detail } = activityText(entry, currency);
        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < items.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-3 left-[5px] h-full w-px bg-row-border"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-background",
                DANGER_TYPES.has(entry.type) ? "bg-danger" : "bg-accent",
              )}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13.5px] text-ink">{title}</span>
              {detail ? (
                <span className="text-xs break-words text-muted-foreground">{detail}</span>
              ) : null}
              <time
                dateTime={new Date(entry.createdAt).toISOString()}
                className="text-xs text-muted-foreground"
              >
                {formatTimestamp(entry.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
