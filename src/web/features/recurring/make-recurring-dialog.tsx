import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "react-aria-components";
import { occurrenceDate } from "../../../shared/recurring";
import type { DocumentDetail } from "../../../shared/schemas/document";
import { recurringCreateInput } from "../../../shared/schemas/recurring";
import { addDays } from "../../../shared/time";
import { Button } from "../../components/ui/button";
import { Dialog, Modal } from "../../components/ui/dialog";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import { useCreateSchedule } from "./queries";
import { TimingFields, type TimingValues } from "./timing-fields";

/** One month after the invoice's issue date, or tomorrow for a draft without a date. */
function defaultStart(doc: DocumentDetail, today: string): string {
  const issue = doc.issueDate;
  if (!issue) return addDays(today, 1);
  const next = occurrenceDate(
    { frequency: "monthly", startDate: issue, anchorDay: Number(issue.slice(8)) },
    1,
  );
  return next > today ? next : addDays(today, 1);
}

export interface MakeRecurringDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentDetail;
  today: string;
}

/** "Make recurring" on an invoice: the schedule copies the client, lines, and terms. */
export function MakeRecurringDialog({
  isOpen,
  onOpenChange,
  document,
  today,
}: MakeRecurringDialogProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog
        title="Make recurring"
        description="The schedule keeps its own copy of the lines. You can edit them later."
      >
        {(close) => <MakeRecurringForm document={document} today={today} close={close} />}
      </Dialog>
    </Modal>
  );
}

function MakeRecurringForm({
  document: doc,
  today,
  close,
}: {
  document: DocumentDetail;
  today: string;
  close: () => void;
}) {
  const navigate = useNavigate();
  const { isOwner } = useMe();
  const create = useCreateSchedule();
  const [name, setName] = useState("");
  const [timing, setTiming] = useState<TimingValues>({
    frequency: "monthly",
    startDate: defaultStart(doc, today),
    endDate: null,
    sendMode: "inherit",
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const input = {
      sourceDocumentId: doc.id,
      name: name || null,
      frequency: timing.frequency,
      startDate: timing.startDate ?? "",
      endDate: timing.endDate,
      sendMode: timing.sendMode,
    };
    const result = validate(recurringCreateInput, input);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      const detail = await create.mutateAsync(input);
      toast({ title: "Recurring schedule created", tone: "success" });
      close();
      void navigate({ to: "/recurring/$scheduleId", params: { scheduleId: detail.id } });
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not create the schedule");
    }
  };

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label="Name (optional)"
        placeholder="Monthly retainer"
        value={name}
        onChange={setName}
        {...fieldError(errors, "name")}
      />
      <TimingFields
        values={timing}
        onChange={setTiming}
        isOwner={isOwner}
        initialSendMode="inherit"
        errors={errors}
      />
      <div className="flex flex-col-reverse gap-2 pb-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onPress={close}>
          Cancel
        </Button>
        <Button type="submit" isPending={create.isPending}>
          Create schedule
        </Button>
      </div>
    </Form>
  );
}
