import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "react-aria-components";
import { firstRepeatDate } from "../../../shared/recurring";
import type { DocumentDetail } from "../../../shared/schemas/document";
import { recurringCreateInput } from "../../../shared/schemas/recurring";
import { Button } from "../../components/ui/button";
import { Dialog, Modal } from "../../components/ui/dialog";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import { useCreateSchedule } from "./queries";
import { TimingFields, type TimingValues } from "./timing-fields";

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
        description="This invoice stays as it is. The schedule creates the next invoices on their dates, with its own copy of the lines."
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
    startDate: null,
    endDate: null,
    sendMode: "inherit",
  });
  // The next invoice is one period after this invoice, until the user picks a date.
  const [startEdited, setStartEdited] = useState(false);
  const values: TimingValues = {
    ...timing,
    startDate: startEdited
      ? timing.startDate
      : firstRepeatDate(timing.frequency, doc.issueDate ?? today, today),
  };
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const input = {
      sourceDocumentId: doc.id,
      name: name || null,
      frequency: values.frequency,
      startDate: values.startDate ?? "",
      endDate: values.endDate,
      sendMode: values.sendMode,
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
        values={values}
        onChange={(next) => {
          if (next.startDate !== values.startDate) setStartEdited(true);
          setTiming(next);
        }}
        startLabel="Next invoice on"
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
