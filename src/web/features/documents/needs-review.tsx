import { Link } from "@tanstack/react-router";
import { CircleAlert, MailCheck, Send } from "lucide-react";
import { useState } from "react";
import type { ReviewJobView } from "../../../shared/schemas/dashboard";
import { jobTypeLabel } from "../../../shared/schemas/dashboard";
import { OwnerOnlyNote } from "../../components/owner-note";
import { Button } from "../../components/ui/button";
import { AlertDialog } from "../../components/ui/dialog";
import { Section } from "../../components/ui/section";
import { toast } from "../../components/ui/toast";
import { cn } from "../../components/ui/utils";
import { toastError } from "../../lib/api";
import { useMe } from "../../lib/session";
import { useResolveReviewJob, useReviewJobs } from "../dashboard/queries";
import { documentPath, formatTimestamp } from "./labels";

/** Shows that an email of the document ended unclear and waits for an Owner. */
export function NeedsReviewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill bg-danger-tint px-[9px] py-[3px] text-xs leading-[1.4] font-medium whitespace-nowrap text-danger-tint-foreground",
        className,
      )}
    >
      <CircleAlert className="size-3.5" aria-hidden="true" />
      Needs review
    </span>
  );
}

/**
 * The two Owner actions on an email that needs review, each behind a confirmation.
 * A Member sees nothing here: the caller shows the Owner-only note.
 */
export function ReviewActions({ jobId }: { jobId: string }) {
  const [confirm, setConfirm] = useState<"mark-sent" | "send-again" | null>(null);
  const markSent = useResolveReviewJob("mark-sent");
  const sendAgain = useResolveReviewJob("send-again");
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        isPending={markSent.isPending}
        onPress={() => setConfirm("mark-sent")}
      >
        <MailCheck className="size-4" aria-hidden="true" />
        Mark as sent
      </Button>
      <Button
        size="sm"
        variant="secondary"
        isPending={sendAgain.isPending}
        onPress={() => setConfirm("send-again")}
      >
        <Send className="size-4" aria-hidden="true" />
        Send again
      </Button>

      <AlertDialog
        isOpen={confirm === "mark-sent"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Mark this email as sent?"
        actionLabel="Mark as sent"
        onAction={() =>
          markSent.mutate(jobId, {
            onSuccess: () => toast({ title: "Marked as sent", tone: "success" }),
            onError: (err) => toastError(err, "Could not mark the email as sent"),
          })
        }
      >
        Use this when the provider logs show that the email went out. No email is sent.
      </AlertDialog>
      <AlertDialog
        isOpen={confirm === "send-again"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Send this email again?"
        actionLabel="Send again"
        variant="danger"
        onAction={() =>
          sendAgain.mutate(jobId, {
            onSuccess: () => toast({ title: "The email is queued again", tone: "success" }),
            onError: (err) => toastError(err, "Could not send the email again"),
          })
        }
      >
        The first email may have gone out. If it did, the client gets the email twice. Check the
        email provider logs first.
      </AlertDialog>
    </>
  );
}

/** The callout on a document whose email needs review. */
export function NeedsReviewCallout({ jobId }: { jobId: string }) {
  const { isOwner } = useMe();
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-card border border-border bg-danger-tint px-4 py-3 sm:flex-row sm:items-center"
    >
      <p className="m-0 flex-1 text-[13px] text-danger-tint-foreground">
        The last email of this document may not have gone out. Check the email provider logs, then
        mark it as sent or send it again.
      </p>
      {isOwner ? (
        <div className="flex flex-wrap gap-2">
          <ReviewActions jobId={jobId} />
        </div>
      ) : (
        <OwnerOnlyNote>Only an Owner can resolve this email.</OwnerOnlyNote>
      )}
    </div>
  );
}

function ReviewRow({ job, isOwner }: { job: ReviewJobView; isOwner: boolean }) {
  const title = job.documentNumber ?? jobTypeLabel(job.type);
  return (
    <li className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {job.documentId && job.documentKind ? (
          <Link
            to={documentPath(job.documentKind)}
            params={{ documentId: job.documentId }}
            className="text-sm font-medium text-ink hover:underline"
          >
            {title}
          </Link>
        ) : (
          <span className="text-sm font-medium text-ink">{title}</span>
        )}
        {job.lastError ? (
          <span className="text-xs break-words text-muted-foreground">{job.lastError}</span>
        ) : null}
        <span className="text-xs text-muted-foreground">{formatTimestamp(job.updatedAt)}</span>
      </div>
      {isOwner ? (
        <div className="flex flex-wrap gap-2">
          <ReviewActions jobId={job.id} />
        </div>
      ) : null}
    </li>
  );
}

/** Emails that ended unclear. Shows nothing when there are none. */
export function NeedsReviewPanel() {
  const { isOwner } = useMe();
  const query = useReviewJobs();
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Section
      title="Emails that need review"
      description="These emails may have gone out. Check the email provider logs before you act."
      flush
    >
      {isOwner ? null : (
        <div className="px-5 pt-4">
          <OwnerOnlyNote>Only an Owner can resolve these emails.</OwnerOnlyNote>
        </div>
      )}
      <ul
        aria-label="Emails that need review"
        className="m-0 list-none divide-y divide-row-border p-0"
      >
        {items.map((job) => (
          <ReviewRow key={job.id} job={job} isOwner={isOwner} />
        ))}
      </ul>
    </Section>
  );
}
