import { Link } from "@tanstack/react-router";
import { Check, CircleAlert, LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DocumentDetail, SendPreview } from "../../../shared/schemas/document";
import { recipientList } from "../../../shared/schemas/email";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, Modal } from "../../components/ui/dialog";
import { Skeleton } from "../../components/ui/skeleton";
import { TextArea, TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { cn } from "../../components/ui/utils";
import { ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { rateText } from "./fx-panel";
import { FX_PROVIDER_LABELS } from "./labels";
import { documentTitle, kindLabel, useSendDocument, useSendPreview } from "./queries";

/** Errors after the number is allocated. The document stays "Ready to send". */
const RETRYABLE = new Set([
  "pdf_pending",
  "pdf_render_failed",
  "email_rejected",
  "email_send_failed",
]);

type Phase =
  | { name: "idle" }
  | { name: "sending"; step: number }
  | { name: "error"; status: number; code: string | undefined; message: string };

export interface SendDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentDetail;
  /**
   * Revise mode. The dialog shows "Email the updated invoice" (checked). Confirm calls
   * `onSave` first. It returns the saved detail, or null when the save failed (the dialog
   * then closes, and the editor keeps the edits).
   */
  revise?: {
    onSave: () => Promise<DocumentDetail | null>;
    /** The issue date the revision will have. */
    issueDate?: string | null;
  };
  /** Called after a successful send or a revision saved without email. */
  onDone?: (detail: DocumentDetail) => void;
}

function defaultMessage(kind: DocumentDetail["kind"]): string {
  return kind === "invoice"
    ? "Thank you for your business."
    : "Let us know if you have any questions.";
}

/** The send dialog: recipients, subject, message, the issue date, and the exchange rate. */
export function SendDialog({ isOpen, onOpenChange, document, revise, onDone }: SendDialogProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg" isDismissable={false}>
      {isOpen ? (
        <SendDialogBody
          document={document}
          revise={revise}
          onDone={onDone}
          close={() => onOpenChange(false)}
        />
      ) : null}
    </Modal>
  );
}

function SendDialogBody({
  document: doc,
  revise,
  onDone,
  close,
}: Omit<SendDialogProps, "isOpen" | "onOpenChange"> & { close: () => void }) {
  const preview = useSendPreview(doc.id, { revise: Boolean(revise) });
  const send = useSendDocument(doc.id);
  const [recipients, setRecipients] = useState<string[] | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [message, setMessage] = useState(defaultMessage(doc.kind));
  const [emailIt, setEmailIt] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [saved, setSaved] = useState<DocumentDetail | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const data = preview.data;
  useEffect(() => {
    if (!data) return;
    setRecipients((current) => current ?? (data.recipients.length > 0 ? data.recipients : [""]));
    setSubject((current) => current ?? data.subject);
  }, [data]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const label = documentTitle(doc);
  const kind = kindLabel(doc.kind).toLowerCase();
  const limitReached = data?.dailyLimit != null ? data.emailsSentToday >= data.dailyLimit : false;
  const fxMissing = data?.fx?.status === "manual_required";
  const willEmail = !revise || emailIt;
  const blocked = willEmail && (!data?.emailConfigured || limitReached || fxMissing);
  const busy = phase.name === "sending";

  const startSteps = () => {
    timers.current.forEach(clearTimeout);
    setPhase({ name: "sending", step: 0 });
    timers.current = [
      setTimeout(() => setPhase((p) => (p.name === "sending" ? { ...p, step: 1 } : p)), 700),
      setTimeout(() => setPhase((p) => (p.name === "sending" ? { ...p, step: 2 } : p)), 2500),
    ];
  };

  const doSend = async () => {
    const list = recipientList.safeParse((recipients ?? []).filter((r) => r.trim()));
    if (!list.success) {
      setErrors({ recipients: list.error.issues[0]?.message ?? "Check the recipients" });
      setPhase({ name: "idle" });
      return false;
    }
    setErrors({});
    startSteps();
    try {
      const result = await send.mutateAsync({
        recipients: list.data,
        subject: subject && subject !== data?.subject ? subject : null,
        message: message.trim() || null,
      });
      timers.current.forEach(clearTimeout);
      toast({
        title: `${documentTitle(result.document)} sent`,
        description: `Emailed to ${result.recipients.join(", ")}.`,
        tone: "success",
      });
      close();
      onDone?.(result.document);
      return true;
    } catch (err) {
      timers.current.forEach(clearTimeout);
      const status = err instanceof ApiError ? err.status : 0;
      const code = err instanceof ApiError ? err.code : undefined;
      setPhase({
        name: "error",
        status,
        code,
        message: err instanceof Error ? err.message : "The send failed",
      });
      return false;
    }
  };

  const confirm = async () => {
    if (revise && !saved) {
      setPhase({ name: "sending", step: 0 });
      const detail = await revise.onSave();
      if (!detail) {
        close();
        return;
      }
      setSaved(detail);
      if (!emailIt) {
        toast({ title: "Revision saved", tone: "success" });
        close();
        onDone?.(detail);
        return;
      }
    }
    await doSend();
  };

  const issueDate = revise?.issueDate ?? data?.issueDate;
  const numbered = doc.number !== null;
  const steps = [
    numbered ? "Freezing the document" : "Assigning the number",
    "Preparing the PDF",
    "Sending the email",
  ];

  return (
    <Dialog
      title={revise ? `Save revision of ${label}` : `Send ${label}`}
      description={`To ${doc.clientName}`}
      showClose={!busy}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={close}>
            {phase.name === "error" ? "Close" : "Cancel"}
          </Button>
          {phase.name === "error" && RETRYABLE.has(phase.code ?? "") ? (
            <Button onPress={() => void doSend()}>Retry</Button>
          ) : phase.name === "error" && phase.status === 429 ? null : (
            <Button
              isPending={busy}
              isDisabled={!data || (blocked && willEmail)}
              onPress={() => void confirm()}
            >
              {revise ? (emailIt ? "Save and email" : "Save revision") : "Send"}
            </Button>
          )}
        </>
      }
    >
      {preview.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : preview.isError || !data ? (
        <Notice tone="danger">The send details could not be loaded. Close and try again.</Notice>
      ) : busy ? (
        <ol aria-label="Progress" className="m-0 flex list-none flex-col gap-3 p-0 py-2">
          {(willEmail ? steps : ["Saving the revision"]).map((text, i) => {
            const state = phase.step > i ? "done" : phase.step === i ? "active" : "waiting";
            return (
              <li key={text} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full",
                    state === "done" ? "bg-tint text-tint-foreground" : "bg-segmented",
                  )}
                >
                  {state === "done" ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : state === "active" ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                </span>
                <span className={state === "waiting" ? "text-muted-foreground" : "text-ink"}>
                  {text}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flex flex-col gap-4">
          {phase.name === "error" ? <SendError phase={phase} kind={kind} /> : null}
          {revise ? (
            <Checkbox isSelected={emailIt} onChange={setEmailIt}>
              Email the updated invoice
            </Checkbox>
          ) : null}

          {willEmail ? (
            <>
              <Blockers data={data} limitReached={limitReached} fxMissing={fxMissing} />
              <RecipientsEditor
                recipients={recipients ?? []}
                onChange={setRecipients}
                error={errors.recipients}
              />
              <TextField label="Subject" value={subject ?? ""} onChange={setSubject} />
              <TextArea
                label="Message"
                description="Shown above the summary and the link. The PDF is attached."
                rows={3}
                value={message}
                onChange={setMessage}
              />
            </>
          ) : (
            <p className="m-0 text-[13px] text-muted-foreground">
              The revision is saved without an email. The public link shows it right away.
            </p>
          )}

          <dl className="m-0 grid gap-x-6 gap-y-2 rounded-button bg-sidebar px-4 py-3 text-[13px] sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Issue date</dt>
              <dd className="m-0 text-ink">{issueDate ? formatDate(issueDate) : "Today"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Exchange rate</dt>
              <dd className="m-0 text-ink">
                {data.fx === null ? (
                  `Not needed (${data.homeCurrency})`
                ) : data.fx.status === "ok" ? (
                  <>
                    <span className="figure">
                      {rateText(data.fx.rate, doc.currency, data.homeCurrency)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {data.fx.provider === "manual"
                        ? `Manual, for ${formatDate(data.fx.rateDate)}`
                        : `Fetched for ${formatDate(data.fx.rateDate)} · ${FX_PROVIDER_LABELS[data.fx.provider]}`}
                    </span>
                  </>
                ) : (
                  "Missing"
                )}
              </dd>
            </div>
          </dl>
          {willEmail && data.dailyLimit !== null ? (
            <p className="m-0 text-xs text-muted-foreground">
              {data.emailsSentToday} of {data.dailyLimit} emails sent in the last 24 hours.
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function Notice({ tone, children }: { tone: "danger" | "neutral"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-button px-3 py-2.5 text-[13px]",
        tone === "danger" ? "bg-danger-tint text-danger-tint-foreground" : "bg-sidebar text-ink",
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function SendError({ phase, kind }: { phase: Extract<Phase, { name: "error" }>; kind: string }) {
  if (phase.status === 429) {
    return (
      <Notice tone="danger">
        <strong className="font-medium">Daily email limit reached</strong>
        <span>{phase.message}</span>
      </Notice>
    );
  }
  const title =
    phase.code === "pdf_pending"
      ? "The PDF is not ready yet"
      : phase.code === "pdf_render_failed"
        ? "The PDF could not be created"
        : phase.code === "email_rejected" || phase.code === "email_send_failed"
          ? "The email provider did not accept the email"
          : "The send failed";
  return (
    <Notice tone="danger">
      <strong className="font-medium">{title}</strong>
      <span>{phase.message}</span>
      {RETRYABLE.has(phase.code ?? "") ? (
        <span>
          The {kind} keeps its number and stays Ready to send. Nothing was emailed. Retry when you
          are ready.
        </span>
      ) : phase.code === "fx_rate_required" ? (
        <span>Edit the {kind} and enter a manual exchange rate, then send again.</span>
      ) : null}
    </Notice>
  );
}

function Blockers({
  data,
  limitReached,
  fxMissing,
}: {
  data: SendPreview;
  limitReached: boolean;
  fxMissing: boolean;
}) {
  if (!data.emailConfigured) {
    return (
      <Notice tone="danger">
        <span>
          Set the sender email and an email provider in{" "}
          <Link to="/settings" className="font-medium underline">
            settings
          </Link>{" "}
          before you send email. You can also download the PDF and mark the document as sent.
        </span>
      </Notice>
    );
  }
  if (limitReached) {
    return (
      <Notice tone="danger">
        <strong className="font-medium">Daily email limit reached</strong>
        <span>
          Every email provider reached its daily limit. Send again later, or download the PDF and
          mark the document as sent.
        </span>
      </Notice>
    );
  }
  if (fxMissing && data.fx?.status === "manual_required") {
    return (
      <Notice tone="danger">
        <strong className="font-medium">An exchange rate is needed</strong>
        <span>
          {data.fx.message.replace(/\.?$/, ".")} Edit the document and enter a manual rate before
          you send.
        </span>
      </Notice>
    );
  }
  if (data.dailyLimit !== null && data.dailyLimit - data.emailsSentToday <= 10) {
    return (
      <Notice tone="neutral">
        Only {data.dailyLimit - data.emailsSentToday} emails are left in the daily limit.
      </Notice>
    );
  }
  return null;
}

function RecipientsEditor({
  recipients,
  onChange,
  error,
}: {
  recipients: string[];
  onChange: (list: string[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[13px] font-medium text-ink">Recipients</legend>
      {recipients.map((email, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
        <div key={index} className="flex items-start gap-2">
          <TextField
            aria-label={`Recipient ${index + 1}`}
            type="email"
            className="flex-1"
            value={email}
            onChange={(text) => onChange(recipients.map((r, i) => (i === index ? text : r)))}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove recipient ${index + 1}`}
            isDisabled={recipients.length === 1}
            onPress={() => onChange(recipients.filter((_, i) => i !== index))}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {error ? <p className="m-0 text-xs font-medium text-danger">{error}</p> : null}
      <div>
        <Button variant="ghost" size="sm" onPress={() => onChange([...recipients, ""])}>
          <Plus className="size-4" aria-hidden="true" />
          Add recipient
        </Button>
      </div>
    </fieldset>
  );
}
