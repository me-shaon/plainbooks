import { useState } from "react";
import { Form } from "react-aria-components";
import {
  REMINDER_MODE_SETTINGS,
  type ReminderModeSetting,
  SEND_MODE_SETTINGS,
  type SendModeSetting,
} from "../../../shared/domain";
import { CURRENCY_CODES, HOME_CURRENCY } from "../../../shared/money";
import {
  type ClientDetail,
  clientCreateInput,
  OWNER_ONLY_MESSAGE,
  REMINDER_MODE_LABELS,
  SEND_MODE_LABELS,
} from "../../../shared/schemas/client";
import { type TaxRate, taxRateLabel } from "../../../shared/schemas/tax-rate";
import type { TemplateSummary } from "../../../shared/schemas/template";
import { Button } from "../../components/ui/button";
import { ComboBox } from "../../components/ui/combo-box";
import { Dialog, Modal } from "../../components/ui/dialog";
import { ListBoxItem } from "../../components/ui/list-box";
import { NumberField } from "../../components/ui/number-field";
import { Select } from "../../components/ui/select";
import { TextArea, TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useTaxRates, useTemplates } from "../../lib/reference-data";
import { useMe } from "../../lib/session";
import { type ContactDraft, ContactsEditor, newContact } from "./contacts-editor";
import { useSaveClient } from "./queries";

const NONE = "__none";

export interface ClientFormValues {
  name: string;
  billingAddress: string;
  taxId: string;
  defaultCurrency: string;
  defaultTaxRateId: string | null;
  /** NaN while the field is empty (the workspace default). */
  paymentTermsDays: number;
  templateId: string | null;
  reminderMode: ReminderModeSetting;
  recurringSendMode: SendModeSetting;
  notes: string;
  contacts: ContactDraft[];
}

export function emptyClientValues(): ClientFormValues {
  return {
    name: "",
    billingAddress: "",
    taxId: "",
    defaultCurrency: HOME_CURRENCY,
    defaultTaxRateId: null,
    paymentTermsDays: Number.NaN,
    templateId: null,
    reminderMode: "inherit",
    recurringSendMode: "inherit",
    notes: "",
    contacts: [newContact(true)],
  };
}

export function clientValuesFrom(detail: ClientDetail): ClientFormValues {
  const { client } = detail;
  return {
    name: client.name,
    billingAddress: client.billingAddress ?? "",
    taxId: client.taxId ?? "",
    defaultCurrency: client.defaultCurrency,
    defaultTaxRateId: client.defaultTaxRateId,
    paymentTermsDays: client.paymentTermsDays ?? Number.NaN,
    templateId: client.templateId,
    reminderMode: client.reminderMode,
    recurringSendMode: client.recurringSendMode,
    notes: client.notes ?? "",
    contacts: detail.contacts.map((contact) => ({
      key: contact.id,
      name: contact.name ?? "",
      email: contact.email,
      isPrimary: contact.isPrimary,
      isBilling: contact.isBilling,
    })),
  };
}

/** The API body for the form values. */
export function toClientInput(values: ClientFormValues) {
  return {
    ...values,
    paymentTermsDays: Number.isNaN(values.paymentTermsDays) ? null : values.paymentTermsDays,
    contacts: values.contacts.map(({ key: _key, ...contact }) => contact),
  };
}

export interface ClientFormProps {
  initialValues: ClientFormValues;
  isOwner: boolean;
  taxRates: TaxRate[];
  templates: TemplateSummary[];
  submitLabel: string;
  /** Saves the values. Return field errors from the server to show them. */
  onSubmit: (input: ReturnType<typeof toClientInput>) => Promise<FieldErrors | undefined>;
  onCancel?: () => void;
}

/**
 * The client form. It validates with the same Zod schema as the API. Members see the
 * auto-send options disabled.
 */
export function ClientForm({
  initialValues,
  isOwner,
  taxRates,
  templates,
  submitLabel,
  onSubmit,
  onCancel,
}: ClientFormProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // A Member cannot choose auto-send, and cannot change a setting that is already auto-send.
  const lockedReminder = !isOwner && initialValues.reminderMode === "auto_send";
  const lockedSend = !isOwner && initialValues.recurringSendMode === "auto_send";
  const memberNote = (locked: boolean) =>
    isOwner ? undefined : locked ? OWNER_ONLY_MESSAGE : "Only an Owner can turn on auto-send";

  const submit = async () => {
    const input = toClientInput(values);
    const result = validate(clientCreateInput, input);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const serverErrors = await onSubmit(input);
      if (serverErrors) setErrors(serverErrors);
    } finally {
      setPending(false);
    }
  };

  // Archived rates stay visible only when the client already uses one.
  const rateOptions = taxRates.filter(
    (rate) => rate.archivedAt === null || rate.id === initialValues.defaultTaxRateId,
  );

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label="Client name"
        isRequired
        autoFocus
        value={values.name}
        onChange={(name) => set("name", name)}
        {...fieldError(errors, "name")}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <ComboBox
          label="Default currency"
          isRequired
          defaultItems={CURRENCY_CODES.map((code) => ({ id: code }))}
          value={values.defaultCurrency}
          onChange={(key) => {
            if (key !== null) set("defaultCurrency", String(key));
          }}
          {...fieldError(errors, "defaultCurrency")}
        >
          {(item: { id: string }) => <ListBoxItem id={item.id}>{item.id}</ListBoxItem>}
        </ComboBox>
        <Select
          label="Default tax rate"
          value={values.defaultTaxRateId ?? NONE}
          onChange={(key) =>
            set("defaultTaxRateId", key === NONE || key === null ? null : String(key))
          }
          {...fieldError(errors, "defaultTaxRateId")}
        >
          <ListBoxItem id={NONE}>No tax</ListBoxItem>
          {rateOptions.map((rate) => (
            <ListBoxItem key={rate.id} id={rate.id}>
              {taxRateLabel(rate)}
            </ListBoxItem>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextArea
          label="Billing address"
          rows={3}
          value={values.billingAddress}
          onChange={(text) => set("billingAddress", text)}
          {...fieldError(errors, "billingAddress")}
        />
        <TextField
          label="Tax ID"
          value={values.taxId}
          onChange={(text) => set("taxId", text)}
          {...fieldError(errors, "taxId")}
        />
      </div>

      <ContactsEditor
        contacts={values.contacts}
        onChange={(contacts) => set("contacts", contacts)}
        errors={errors}
      />

      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-medium text-ink">
          Defaults for this client
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Payment terms (days)"
            placeholder="Workspace default"
            minValue={0}
            maxValue={365}
            step={1}
            value={values.paymentTermsDays}
            onChange={(days) => set("paymentTermsDays", days)}
            description="Leave empty to use the workspace default."
            {...fieldError(errors, "paymentTermsDays")}
          />
          <Select
            label="Template"
            value={values.templateId ?? NONE}
            onChange={(key) => set("templateId", key === NONE || key === null ? null : String(key))}
          >
            <ListBoxItem id={NONE}>Workspace default</ListBoxItem>
            {templates.map((template) => (
              <ListBoxItem key={template.id} id={template.id}>
                {template.name}
              </ListBoxItem>
            ))}
          </Select>
          <Select
            label="Reminders"
            value={values.reminderMode}
            isDisabled={lockedReminder}
            disabledKeys={isOwner ? undefined : ["auto_send"]}
            onChange={(key) => key && set("reminderMode", key as ReminderModeSetting)}
            description={memberNote(lockedReminder)}
            {...fieldError(errors, "reminderMode")}
          >
            {REMINDER_MODE_SETTINGS.map((mode) => (
              <ListBoxItem key={mode} id={mode}>
                {REMINDER_MODE_LABELS[mode]}
              </ListBoxItem>
            ))}
          </Select>
          <Select
            label="Recurring invoices"
            value={values.recurringSendMode}
            isDisabled={lockedSend}
            disabledKeys={isOwner ? undefined : ["auto_send"]}
            onChange={(key) => key && set("recurringSendMode", key as SendModeSetting)}
            description={memberNote(lockedSend)}
            {...fieldError(errors, "recurringSendMode")}
          >
            {SEND_MODE_SETTINGS.map((mode) => (
              <ListBoxItem key={mode} id={mode}>
                {SEND_MODE_LABELS[mode]}
              </ListBoxItem>
            ))}
          </Select>
        </div>
      </fieldset>

      <TextArea
        label="Internal notes"
        description="Only your team sees these notes."
        rows={3}
        value={values.notes}
        onChange={(text) => set("notes", text)}
        {...fieldError(errors, "notes")}
      />

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button variant="secondary" onPress={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" isPending={pending}>
          {submitLabel}
        </Button>
      </div>
    </Form>
  );
}

/** The create or edit dialog. Pass `client` to edit. */
export function ClientFormDialog({
  isOpen,
  onOpenChange,
  client,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientDetail;
  onSaved?: (detail: ClientDetail) => void;
}) {
  const { isOwner } = useMe();
  const taxRates = useTaxRates({ includeArchived: true });
  const templates = useTemplates();
  const save = useSaveClient();

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <Dialog title={client ? "Edit client" : "New client"}>
        {(close) => (
          <ClientForm
            initialValues={client ? clientValuesFrom(client) : emptyClientValues()}
            isOwner={isOwner}
            taxRates={taxRates.data ?? []}
            templates={templates.data ?? []}
            submitLabel={client ? "Save changes" : "Create client"}
            onCancel={close}
            onSubmit={async (input) => {
              try {
                const detail = await save.mutateAsync({ id: client?.client.id, input });
                toast({ title: client ? "Client saved" : "Client created", tone: "success" });
                close();
                onSaved?.(detail);
                return undefined;
              } catch (err) {
                const fieldErrors = issuesByPath(err);
                if (Object.keys(fieldErrors).length > 0) return fieldErrors;
                toastError(err, "Could not save the client");
                return undefined;
              }
            }}
          />
        )}
      </Dialog>
    </Modal>
  );
}
