import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  CheckCheck,
  Copy,
  Download,
  Ellipsis,
  FileOutput,
  Link2,
  Link2Off,
  Pencil,
  RotateCw,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DocumentDetail } from "../../../shared/schemas/document";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { AlertDialog } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { Menu, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { Pill } from "../../components/ui/pill";
import { DetailItem, Section } from "../../components/ui/section";
import { Skeleton } from "../../components/ui/skeleton";
import { toast } from "../../components/ui/toast";
import { formatDate, formatMoney } from "../../lib/format";
import { MakeRecurringDialog } from "../recurring/make-recurring-dialog";
import { ReminderPanel } from "../reminders/reminder-panel";
import { ActivityTimeline } from "./activity-timeline";
import { editPath, FX_PROVIDER_LABELS } from "./labels";
import { PaymentDialog } from "./payment-dialog";
import { downloadPdf } from "./pdf";
import {
  documentTitle,
  kindLabel,
  useDeleteDocument,
  useDeletePayment,
  useDocument,
  useDocumentAction,
  useDocumentActivity,
  useDocumentRevisions,
  useWorkspaceToday,
} from "./queries";
import { SendDialog } from "./send-dialog";
import { TotalsPanel } from "./totals-panel";

type Confirm = "mark-sent" | "void" | "write-off" | "delete" | "reset-link" | null;

/** What a document allows in its current state. */
export function documentActions(doc: DocumentDetail) {
  const invoice = doc.kind === "invoice";
  const s = doc.status;
  const isDraft = s === "draft" && doc.number === null;
  const isReady = doc.displayStatus === "finalized";
  return {
    isDraft,
    isReady,
    canEdit: isDraft,
    canDelete: isDraft,
    canSend: invoice
      ? ["draft", "finalized", "sent", "partially_paid"].includes(s)
      : s === "draft" || s === "sent",
    sendLabel: isDraft ? "Send" : isReady ? "Retry send" : "Send again",
    canMarkSent: isDraft || isReady,
    canRevise: invoice && s === "sent" && doc.payments.length === 0,
    canPay: invoice && (s === "sent" || s === "partially_paid"),
    canWriteOff: invoice && s === "partially_paid",
    canVoid: invoice && (s === "finalized" || s === "sent") && doc.amountPaid === 0,
    canConvert: !invoice && s === "accepted",
    hasPublicLink: Boolean(doc.publicToken && doc.number),
    hasPdf: doc.currentRevisionId !== null,
  };
}

export function DocumentDetailPage({
  documentId,
  openSend = false,
}: {
  documentId: string;
  /** Opens the send dialog on load ("Save and send" in the editor). */
  openSend?: boolean;
}) {
  const query = useDocument(documentId);
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="This document could not be loaded"
        description={query.error.message}
        action={
          <Link to="/invoices" className="text-sm font-medium text-accent underline">
            Back to invoices
          </Link>
        }
      />
    );
  }
  return <DocumentDetailView doc={query.data} openSend={openSend} />;
}

function DocumentDetailView({ doc, openSend }: { doc: DocumentDetail; openSend: boolean }) {
  const navigate = useNavigate();
  const today = useWorkspaceToday();
  const actions = documentActions(doc);
  const [sending, setSending] = useState(openSend && actions.canSend);
  const [paying, setPaying] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null);

  const markSent = useDocumentAction(doc.id, "mark-sent");
  const voidDoc = useDocumentAction(doc.id, "void");
  const writeOff = useDocumentAction(doc.id, "write-off");
  const duplicate = useDocumentAction(doc.id, "duplicate");
  const convert = useDocumentAction(doc.id, "convert");
  const resetLink = useDocumentAction(doc.id, "reset-link");
  const remove = useDeleteDocument(doc.id);
  const deletePayment = useDeletePayment(doc.id);
  const activity = useDocumentActivity(doc.id);
  const revisions = useDocumentRevisions(doc.id, doc.revisionCount > 0);

  const title = documentTitle(doc);
  const kind = kindLabel(doc.kind);
  const listPath = doc.kind === "invoice" ? "/invoices" : "/quotes";
  const filename = `${doc.number ?? "draft"}.pdf`;
  const previewSrc = doc.currentRevisionId
    ? `/render/${doc.currentRevisionId}`
    : `/render/draft/${doc.id}`;

  const copyLink = async () => {
    const url = `${window.location.origin}/p/${doc.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url, tone: "success" });
    } catch {
      toast({ title: "Copy this link", description: url });
    }
  };

  const onDuplicate = () =>
    duplicate.mutate(undefined, {
      onSuccess: (copy) => {
        toast({
          title: `${kind} duplicated`,
          description: "The copy is a new draft.",
          tone: "success",
        });
        void navigate({ to: editPath(copy.kind), params: { documentId: copy.id } });
      },
    });
  const onConvert = () =>
    convert.mutate(undefined, {
      onSuccess: (invoice) => {
        toast({ title: "Invoice created from the quote", tone: "success" });
        void navigate({ to: "/invoices/$documentId", params: { documentId: invoice.id } });
      },
    });

  let primary: ReactNode = null;
  if (actions.canConvert) {
    primary = (
      <Button isPending={convert.isPending} onPress={onConvert}>
        <FileOutput className="size-4" aria-hidden="true" />
        Convert to invoice
      </Button>
    );
  } else if (actions.isDraft || actions.isReady) {
    primary = (
      <Button onPress={() => setSending(true)}>
        <Send className="size-4" aria-hidden="true" />
        {actions.sendLabel}
      </Button>
    );
  } else if (actions.canPay) {
    primary = (
      <Button onPress={() => setPaying(true)}>
        <Wallet className="size-4" aria-hidden="true" />
        Record payment
      </Button>
    );
  } else if (doc.convertedInvoiceId) {
    primary = (
      <Link
        to="/invoices/$documentId"
        params={{ documentId: doc.convertedInvoiceId }}
        className="inline-flex min-h-10 items-center rounded-button bg-ink px-4 text-sm font-medium text-ink-foreground"
      >
        Open the invoice
      </Link>
    );
  }

  const menuItems: {
    id: string;
    label: string;
    icon: ReactNode;
    danger?: boolean;
    run: () => void;
  }[] = [];
  if (actions.canSend && !(actions.isDraft || actions.isReady)) {
    menuItems.push({
      id: "send",
      label: actions.sendLabel,
      icon: <Send />,
      run: () => setSending(true),
    });
  }
  if (actions.canMarkSent) {
    menuItems.push({
      id: "mark-sent",
      label: "Mark as sent",
      icon: <CheckCheck />,
      run: () => setConfirm("mark-sent"),
    });
  }
  if (actions.canRevise) {
    menuItems.push({
      id: "revise",
      label: "Revise",
      icon: <Pencil />,
      run: () => void navigate({ to: editPath(doc.kind), params: { documentId: doc.id } }),
    });
  }
  if (actions.canWriteOff) {
    menuItems.push({
      id: "write-off",
      label: "Write off remainder",
      icon: <Wallet />,
      run: () => setConfirm("write-off"),
    });
  }
  menuItems.push({ id: "duplicate", label: "Duplicate", icon: <Copy />, run: onDuplicate });
  if (doc.kind === "invoice" && doc.status !== "void" && doc.lines.length > 0) {
    menuItems.push({
      id: "recurring",
      label: "Make recurring",
      icon: <RotateCw />,
      run: () => setRepeating(true),
    });
  }
  if (actions.hasPublicLink) {
    menuItems.push({
      id: "reset-link",
      label: "Reset public link",
      icon: <Link2Off />,
      danger: true,
      run: () => setConfirm("reset-link"),
    });
  }
  if (actions.canVoid) {
    menuItems.push({
      id: "void",
      label: "Void",
      icon: <Ban />,
      danger: true,
      run: () => setConfirm("void"),
    });
  }
  if (actions.canDelete) {
    menuItems.push({
      id: "delete",
      label: "Delete draft",
      icon: <Trash2 />,
      danger: true,
      run: () => setConfirm("delete"),
    });
  }

  return (
    <>
      <Link
        to={listPath}
        className="-mb-4 inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {doc.kind === "invoice" ? "Invoices" : "Quotes"}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            <Pill status={doc.displayStatus} />
          </span>
        }
        subtitle={
          <>
            <Link
              to="/clients/$clientId"
              params={{ clientId: doc.clientId }}
              className="text-ink hover:underline"
            >
              {doc.clientName}
            </Link>{" "}
            · <span className="figure">{formatMoney(doc.total, doc.currency)}</span>
          </>
        }
        actions={
          <>
            {actions.canEdit ? (
              <Button
                variant="secondary"
                onPress={() => navigate({ to: editPath(doc.kind), params: { documentId: doc.id } })}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Button>
            ) : null}
            {actions.hasPublicLink ? (
              <Button variant="secondary" onPress={() => void copyLink()}>
                <Link2 className="size-4" aria-hidden="true" />
                Copy public link
              </Button>
            ) : null}
            {actions.hasPdf ? (
              <Button variant="secondary" onPress={() => void downloadPdf(doc.id, { filename })}>
                <Download className="size-4" aria-hidden="true" />
                Download PDF
              </Button>
            ) : null}
            {primary}
            <MenuTrigger>
              <Button variant="secondary" size="icon" aria-label="More actions">
                <Ellipsis className="size-4" aria-hidden="true" />
              </Button>
              <Menu
                items={menuItems}
                onAction={(key) => menuItems.find((item) => item.id === key)?.run()}
              >
                {(item) => (
                  <MenuItem
                    id={item.id}
                    textValue={item.label}
                    variant={item.danger ? "danger" : "default"}
                  >
                    {item.icon}
                    {item.label}
                  </MenuItem>
                )}
              </Menu>
            </MenuTrigger>
          </>
        }
      />

      {actions.isReady ? (
        <p
          role="status"
          className="m-0 rounded-button border border-border bg-sidebar px-4 py-3 text-[13px] text-ink"
        >
          This {kind.toLowerCase()} has its number but was not sent. Retry the send, or mark it as
          sent if you delivered it yourself.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section
          aria-label={`${kind} preview`}
          className="min-w-0 self-start overflow-hidden rounded-card border border-border bg-sidebar p-3 md:p-5"
        >
          <PreviewFrame
            key={`${previewSrc}-${doc.updatedAt}`}
            title={`${title} preview`}
            src={previewSrc}
          />
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Summary">
            <div className="flex flex-col gap-4">
              <TotalsPanel
                totals={{
                  currency: doc.currency,
                  subtotal: doc.subtotal,
                  discount: doc.discountTotal,
                  taxTotal: doc.taxTotal,
                  total: doc.total,
                }}
                amountPaid={doc.amountPaid}
              />
              <dl className="m-0 grid grid-cols-2 gap-3">
                <DetailItem label="Issued">{formatDate(doc.issueDate) || "On send"}</DetailItem>
                {doc.kind === "invoice" ? (
                  <DetailItem label="Due">
                    {formatDate(doc.dueDate) ||
                      (doc.paymentTermsDays !== null
                        ? `${doc.paymentTermsDays} days after issue`
                        : "From the terms")}
                  </DetailItem>
                ) : (
                  <DetailItem label="Expires">
                    {formatDate(doc.expiryDate) || "From the issue date"}
                  </DetailItem>
                )}
                {doc.fx.rate ? (
                  <DetailItem label="Exchange rate">
                    <span className="figure">{doc.fx.rate}</span>
                    {doc.fx.provider ? ` · ${FX_PROVIDER_LABELS[doc.fx.provider]}` : ""}
                  </DetailItem>
                ) : null}
                {doc.sourceQuoteId ? (
                  <DetailItem label="From quote">
                    <Link
                      to="/quotes/$documentId"
                      params={{ documentId: doc.sourceQuoteId }}
                      className="text-accent underline"
                    >
                      Open the quote
                    </Link>
                  </DetailItem>
                ) : null}
                {doc.decisionComment ? (
                  <DetailItem label="Client comment">{doc.decisionComment}</DetailItem>
                ) : null}
              </dl>
            </div>
          </Section>

          {doc.kind === "invoice" ? (
            <Section
              title="Payments"
              flush
              actions={
                actions.canPay ? (
                  <Button size="sm" variant="secondary" onPress={() => setPaying(true)}>
                    Record payment
                  </Button>
                ) : null
              }
            >
              {doc.payments.length === 0 ? (
                <p className="m-0 px-5 py-4 text-[13px] text-muted-foreground">No payments yet.</p>
              ) : (
                <ul aria-label="Payments" className="m-0 list-none divide-y divide-row-border p-0">
                  {doc.payments.map((payment) => (
                    <li key={payment.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="figure text-sm">
                          {formatMoney(payment.amount, doc.currency)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {payment.kind === "write_off" ? "Written off" : "Paid"} on{" "}
                          {formatDate(payment.paidOn)}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </span>
                      </div>
                      {doc.status !== "void" ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete payment of ${formatMoney(payment.amount, doc.currency)}`}
                          onPress={() => setPaymentToDelete(payment.id)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          {doc.kind === "invoice" && doc.number !== null ? <ReminderPanel document={doc} /> : null}

          <Section title="Activity">
            <ActivityTimeline
              items={activity.data}
              currency={doc.currency}
              isPending={activity.isPending}
            />
          </Section>

          {doc.revisionCount > 0 ? (
            <Section title="Revisions" flush>
              <ul aria-label="Revisions" className="m-0 list-none divide-y divide-row-border p-0">
                {(revisions.data ?? []).map((revision) => (
                  <li key={revision.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm">
                        Revision {revision.revisionNumber}
                        {revision.id === doc.currentRevisionId ? " (current)" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Issued {formatDate(revision.issueDate)} ·{" "}
                        <span className="figure">{formatMoney(revision.total, doc.currency)}</span>
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Download the PDF of revision ${revision.revisionNumber}`}
                      onPress={() =>
                        void downloadPdf(doc.id, {
                          revision: revision.revisionNumber,
                          filename: `${doc.number ?? "document"}-r${revision.revisionNumber}.pdf`,
                        })
                      }
                    >
                      <Download className="size-4" aria-hidden="true" />
                      PDF
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      <SendDialog isOpen={sending} onOpenChange={setSending} document={doc} />
      {doc.kind === "invoice" ? (
        <MakeRecurringDialog
          isOpen={repeating}
          onOpenChange={setRepeating}
          document={doc}
          today={today}
        />
      ) : null}
      {actions.canPay ? (
        <PaymentDialog isOpen={paying} onOpenChange={setPaying} document={doc} today={today} />
      ) : null}

      <AlertDialog
        isOpen={confirm === "mark-sent"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Mark ${title} as sent?`}
        actionLabel="Mark as sent"
        onAction={() =>
          markSent.mutate(undefined, {
            onSuccess: (detail) =>
              toast({ title: `${documentTitle(detail)} marked as sent`, tone: "success" }),
          })
        }
      >
        Use this when you sent the link or the PDF yourself. The {kind.toLowerCase()} gets its
        number now, and no email is sent.
      </AlertDialog>
      <AlertDialog
        isOpen={confirm === "void"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Void ${title}?`}
        actionLabel="Void invoice"
        variant="danger"
        onAction={() =>
          voidDoc.mutate(undefined, {
            onSuccess: () => toast({ title: "Invoice voided", tone: "success" }),
          })
        }
      >
        The invoice keeps its number and its public link shows a Void banner. Reports leave it out.
        You cannot undo this.
      </AlertDialog>
      <AlertDialog
        isOpen={confirm === "reset-link"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reset the public link?"
        actionLabel="Reset link"
        variant="danger"
        onAction={() =>
          resetLink.mutate(undefined, {
            onSuccess: () => toast({ title: "Public link reset", tone: "success" }),
          })
        }
      >
        Every link sent before stops working, including links in emails. Copy the new link and send
        it again to the right people.
      </AlertDialog>
      <AlertDialog
        isOpen={confirm === "write-off"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Write off ${formatMoney(doc.balance, doc.currency)}?`}
        actionLabel="Write off remainder"
        onAction={() =>
          writeOff.mutate(undefined, {
            onSuccess: () => toast({ title: "Remainder written off", tone: "success" }),
          })
        }
      >
        The invoice becomes paid. The written-off amount is recorded on its own line.
      </AlertDialog>
      <AlertDialog
        isOpen={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this draft?"
        actionLabel="Delete draft"
        variant="danger"
        onAction={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast({ title: "Draft deleted", tone: "success" });
              void navigate({ to: listPath });
            },
          })
        }
      >
        The draft and its lines are deleted. You cannot undo this.
      </AlertDialog>
      <AlertDialog
        isOpen={paymentToDelete !== null}
        onOpenChange={(open) => !open && setPaymentToDelete(null)}
        title="Delete this payment?"
        actionLabel="Delete payment"
        variant="danger"
        onAction={() => {
          if (!paymentToDelete) return;
          deletePayment.mutate(paymentToDelete, {
            onSuccess: () => toast({ title: "Payment deleted", tone: "success" }),
          });
        }}
      >
        The balance and the status are recalculated.
      </AlertDialog>
    </>
  );
}

/**
 * The rendered document. The frame grows to the height of the page inside it, so the page
 * scrolls once and the preview never adds a second scroll bar. The render is same-origin.
 */
function PreviewFrame({ title, src }: { title: string; src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const fit = () => {
      const root = frame.contentDocument?.documentElement;
      if (!root) return;
      setHeight(root.scrollHeight);
      observer?.disconnect();
      observer = new ResizeObserver(() => setHeight(root.scrollHeight));
      observer.observe(root);
    };
    frame.addEventListener("load", fit);
    return () => {
      frame.removeEventListener("load", fit);
      observer?.disconnect();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      title={title}
      src={src}
      scrolling="no"
      style={height ? { height } : undefined}
      className="block min-h-[560px] w-full rounded-small border-0 bg-white shadow-raised"
    />
  );
}
