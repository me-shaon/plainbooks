import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import { formatMinor } from "../../../shared/money";
import {
  FREQUENCY_LABELS,
  pausedReasonText,
  type RecurringDetail,
  recurringUpdateInput,
} from "../../../shared/schemas/recurring";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { AlertDialog } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { NumberField } from "../../components/ui/number-field";
import { Pill } from "../../components/ui/pill";
import { DetailItem, Section } from "../../components/ui/section";
import { Skeleton } from "../../components/ui/skeleton";
import { TextArea, TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { formatDate, formatMoney } from "../../lib/format";
import { useTaxRates } from "../../lib/reference-data";
import { useMe } from "../../lib/session";
import { editorTotals, emptyValues, type LineDraft, minorOf } from "../documents/editor-state";
import { LineItems } from "../documents/line-items";
import { useWorkspaceSettings } from "../settings/queries";
import { useDeleteSchedule, useSchedule, useScheduleAction, useUpdateSchedule } from "./queries";
import { nextIssueText } from "./recurring-page";
import { ScheduleStatusPill } from "./schedule-status";
import { TimingFields, type TimingValues } from "./timing-fields";

export function SchedulePage({ scheduleId }: { scheduleId: string }) {
  const query = useSchedule(scheduleId);
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="This schedule could not be loaded"
        description={query.error.message}
        action={
          <Link to="/recurring" className="text-sm font-medium text-accent underline">
            Back to recurring
          </Link>
        }
      />
    );
  }
  return <ScheduleView key={query.data.id} schedule={query.data} />;
}

function linesOf(s: RecurringDetail): LineDraft[] {
  return s.lines.map((line) => ({
    key: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: formatMinor(line.unitPrice, s.currency),
    taxRateId: line.taxRateId,
  }));
}

function ScheduleView({ schedule: s }: { schedule: RecurringDetail }) {
  const navigate = useNavigate();
  const { isOwner } = useMe();
  const settings = useWorkspaceSettings();
  const taxRates = useTaxRates({ includeArchived: true });
  const update = useUpdateSchedule(s.id);
  const pause = useScheduleAction(s.id, "pause");
  const resume = useScheduleAction(s.id, "resume");
  const remove = useDeleteSchedule(s.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState(s.name ?? "");
  const [timing, setTiming] = useState<TimingValues>({
    frequency: s.frequency,
    startDate: s.startDate,
    endDate: s.endDate,
    sendMode: s.sendMode,
  });
  const [terms, setTerms] = useState<number>(s.paymentTermsDays ?? Number.NaN);
  const [lines, setLines] = useState<LineDraft[]>(() => linesOf(s));
  const [notes, setNotes] = useState(s.notes ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const totals = editorTotals(
    {
      ...emptyValues("invoice", s.currency),
      lines,
      discountType: s.discount.type,
      discountPercent: s.discount.type === "percent" ? s.discount.percent : "",
      discountAmount: s.discount.type === "fixed" ? formatMinor(s.discount.amount, s.currency) : "",
    },
    taxRates.data ?? [],
  ).totals;

  const save = async () => {
    const input = {
      name: name || null,
      frequency: timing.frequency,
      startDate: timing.startDate ?? "",
      endDate: timing.endDate,
      sendMode: timing.sendMode,
      paymentTermsDays: Number.isFinite(terms) ? terms : null,
      notes: notes || null,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: line.quantity || "0",
        unitPrice: minorOf(line.unitPrice, s.currency),
        taxRateId: line.taxRateId,
      })),
    };
    const result = validate(recurringUpdateInput, input);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(input);
      toast({ title: "Schedule saved", tone: "success" });
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not save the schedule");
    }
  };

  const title = s.name ? `${s.clientName} · ${s.name}` : `${s.clientName} recurring invoice`;
  const reason = pausedReasonText(s.pausedReason);

  return (
    <>
      <Link
        to="/recurring"
        className="-mb-4 inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Recurring
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            <ScheduleStatusPill status={s.status} />
          </span>
        }
        subtitle={
          <>
            {FREQUENCY_LABELS[s.frequency]} ·{" "}
            <span className="figure">{formatMoney(s.total, s.currency)}</span>
          </>
        }
        actions={
          <>
            {s.status === "active" ? (
              <Button
                variant="secondary"
                isPending={pause.isPending}
                onPress={() =>
                  pause.mutate(undefined, {
                    onSuccess: () => toast({ title: "Schedule paused", tone: "success" }),
                  })
                }
              >
                <Pause className="size-4" aria-hidden="true" />
                Pause
              </Button>
            ) : null}
            {s.status === "paused" ? (
              <Button
                variant="secondary"
                isPending={resume.isPending}
                onPress={() =>
                  resume.mutate(undefined, {
                    onSuccess: (detail) =>
                      toast({
                        title: "Schedule resumed",
                        description: `Next issue date: ${formatDate(detail.nextIssueDate)}`,
                        tone: "success",
                      }),
                  })
                }
              >
                <Play className="size-4" aria-hidden="true" />
                Resume
              </Button>
            ) : null}
            <Button variant="secondary" onPress={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Form
          validationBehavior="aria"
          className="flex min-w-0 flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Section title="Schedule">
            <div className="flex flex-col gap-4">
              <TextField
                label="Name (optional)"
                value={name}
                onChange={setName}
                {...fieldError(errors, "name")}
              />
              <TimingFields
                values={timing}
                onChange={setTiming}
                isOwner={isOwner}
                initialSendMode={s.sendMode}
                errors={errors}
              />
              <NumberField
                label="Payment terms (days)"
                className="sm:max-w-56"
                minValue={0}
                maxValue={365}
                value={terms}
                onChange={setTerms}
                description="Empty uses the client terms, then the workspace terms."
                {...fieldError(errors, "paymentTermsDays")}
              />
            </div>
          </Section>

          <Section
            title="Lines"
            description="The schedule's own copy. Changes apply to the next invoices only."
          >
            <LineItems
              lines={lines}
              currency={s.currency}
              taxRates={taxRates.data ?? []}
              defaultTaxRateId={settings.data?.defaultTaxRateId ?? null}
              totals={totals}
              onChange={setLines}
              errors={errors}
            />
          </Section>

          <Section title="Notes">
            <TextArea
              label="Notes on each invoice"
              rows={3}
              value={notes}
              onChange={setNotes}
              {...fieldError(errors, "notes")}
            />
          </Section>

          <div className="flex justify-end">
            <Button type="submit" isPending={update.isPending}>
              Save schedule
            </Button>
          </div>
        </Form>

        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Next invoice">
            <dl className="m-0 grid grid-cols-1 gap-3">
              <DetailItem label="Next issue date">{nextIssueText(s)}</DetailItem>
              {reason ? <DetailItem label="Status">{reason}</DetailItem> : null}
              {s.upcoming.length > 1 ? (
                <DetailItem label="After that">
                  {s.upcoming.slice(1).map(formatDate).join(", ")}
                </DetailItem>
              ) : null}
              <DetailItem label="Send mode">
                {s.resolvedSendMode === "auto_send"
                  ? "Created and emailed to the client"
                  : "Created as a draft. The owner gets a notice to review it."}
                {s.sendMode === "inherit" ? " (from the client or workspace default)" : ""}
              </DetailItem>
              {s.sourceDocumentId ? (
                <DetailItem label="Made from">
                  <Link
                    to="/invoices/$documentId"
                    params={{ documentId: s.sourceDocumentId }}
                    className="text-accent underline"
                  >
                    The source invoice
                  </Link>
                </DetailItem>
              ) : null}
            </dl>
          </Section>

          <Section title="Invoices" flush>
            {s.invoices.length === 0 ? (
              <p className="m-0 px-5 py-4 text-[13px] text-muted-foreground">
                No invoices from this schedule yet.
              </p>
            ) : (
              <ul aria-label="Invoices" className="m-0 list-none divide-y divide-row-border p-0">
                {s.invoices.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      to="/invoices/$documentId"
                      params={{ documentId: doc.id }}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-sidebar"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm">{doc.number ?? "Draft invoice"}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(doc.issueDate)} ·{" "}
                          <span className="figure">{formatMoney(doc.total, s.currency)}</span>
                        </span>
                      </span>
                      <Pill status={doc.displayStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this schedule?"
        actionLabel="Delete schedule"
        variant="danger"
        onAction={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast({ title: "Schedule deleted", tone: "success" });
              void navigate({ to: "/recurring" });
            },
          })
        }
      >
        No more invoices are created. The invoices it already created stay.
      </AlertDialog>
    </>
  );
}
