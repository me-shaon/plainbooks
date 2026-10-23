import { useState } from "react";
import { Form } from "react-aria-components";
import { formatMinor } from "../../../shared/money";
import type { DocumentDetail } from "../../../shared/schemas/document";
import { Button } from "../../components/ui/button";
import { IsoDatePicker } from "../../components/ui/date-picker";
import { Dialog, Modal } from "../../components/ui/dialog";
import { MoneyField } from "../../components/ui/money-field";
import { TextArea } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { ApiError, issuesByPath, toastError } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { minorOf } from "./editor-state";
import { useRecordPayment } from "./queries";

export interface PaymentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentDetail;
  /** Today in the workspace timezone. */
  today: string;
}

/** Records a full or partial payment. The amount starts at the open balance. */
export function PaymentDialog({ isOpen, onOpenChange, document, today }: PaymentDialogProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog
        title="Record payment"
        description={`Balance ${formatMoney(document.balance, document.currency)}`}
      >
        {(close) => <PaymentForm document={document} today={today} close={close} />}
      </Dialog>
    </Modal>
  );
}

function PaymentForm({
  document: doc,
  today,
  close,
}: {
  document: DocumentDetail;
  today: string;
  close: () => void;
}) {
  const record = useRecordPayment(doc.id);
  const [amount, setAmount] = useState(formatMinor(doc.balance, doc.currency));
  const [paidOn, setPaidOn] = useState<string | null>(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    const minor = minorOf(amount, doc.currency);
    const next: Record<string, string> = {};
    if (minor <= 0) next.amount = "Enter an amount above 0";
    else if (minor > doc.balance) {
      next.amount = `The payment is larger than the balance of ${formatMoney(doc.balance, doc.currency)}`;
    }
    if (!paidOn) next.paidOn = "Enter the payment date";
    setErrors(next);
    if (Object.keys(next).length > 0 || !paidOn) return;
    try {
      await record.mutateAsync({ amount: minor, paidOn, note: note || null });
      toast({ title: "Payment recorded", tone: "success" });
      close();
    } catch (err) {
      if (err instanceof ApiError && err.code === "overpayment") {
        setErrors({ amount: err.message });
        return;
      }
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not record the payment");
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
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField
          label={`Amount (${doc.currency})`}
          currency={doc.currency}
          autoFocus
          value={amount}
          onChange={setAmount}
          isInvalid={Boolean(errors.amount)}
          errorMessage={errors.amount}
        />
        <IsoDatePicker
          label="Paid on"
          value={paidOn}
          onChange={setPaidOn}
          isInvalid={Boolean(errors.paidOn)}
          errorMessage={errors.paidOn}
        />
      </div>
      <TextArea label="Note" rows={2} value={note} onChange={setNote} />
      <div className="flex flex-col-reverse gap-2 pb-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onPress={close}>
          Cancel
        </Button>
        <Button type="submit" isPending={record.isPending}>
          Record payment
        </Button>
      </div>
    </Form>
  );
}
