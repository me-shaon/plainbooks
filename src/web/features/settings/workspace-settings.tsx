import { useMemo, useState } from "react";
import { Form } from "react-aria-components";
import { CURRENCY_CODES } from "../../../shared/money";
import {
  exampleNumber,
  type WorkspaceSettings,
  workspaceSettingsInput,
} from "../../../shared/schemas/settings";
import { taxRateLabel } from "../../../shared/schemas/tax-rate";
import { Button } from "../../components/ui/button";
import { ComboBox } from "../../components/ui/combo-box";
import { ListBoxItem } from "../../components/ui/list-box";
import { NumberField } from "../../components/ui/number-field";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useTaxRates, useTemplates } from "../../lib/reference-data";
import { useMe } from "../../lib/session";
import { useUpdateWorkspace, useWorkspaceSettings } from "./queries";
import { SaveBar } from "./settings-layout";

const NONE = "__none";

function timeZones(current: string): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes(current) ? zones : [current, ...zones];
}

export function WorkspaceSettingsPage() {
  const settings = useWorkspaceSettings();
  const { isOwner } = useMe();
  if (settings.isPending) return <Skeleton className="h-96 w-full" />;
  if (settings.isError) return null;
  return (
    <WorkspaceSettingsForm
      key={JSON.stringify(settings.data)}
      settings={settings.data}
      readOnly={!isOwner}
    />
  );
}

type Values = Pick<
  WorkspaceSettings,
  | "name"
  | "homeCurrency"
  | "timezone"
  | "invoicePrefix"
  | "quotePrefix"
  | "numberPadding"
  | "defaultPaymentTermsDays"
  | "defaultQuoteValidityDays"
  | "defaultTemplateId"
  | "defaultTaxRateId"
  | "emailFromName"
  | "emailFromAddress"
  | "replyToEmail"
>;

export function WorkspaceSettingsForm({
  settings,
  readOnly,
}: {
  settings: WorkspaceSettings;
  readOnly: boolean;
}) {
  const [values, setValues] = useState<Values>(() => ({
    name: settings.name,
    homeCurrency: settings.homeCurrency,
    timezone: settings.timezone,
    invoicePrefix: settings.invoicePrefix,
    quotePrefix: settings.quotePrefix,
    numberPadding: settings.numberPadding,
    defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
    defaultQuoteValidityDays: settings.defaultQuoteValidityDays,
    defaultTemplateId: settings.defaultTemplateId,
    defaultTaxRateId: settings.defaultTaxRateId,
    emailFromName: settings.emailFromName,
    emailFromAddress: settings.emailFromAddress,
    replyToEmail: settings.replyToEmail,
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateWorkspace();
  const taxRates = useTaxRates();
  const templates = useTemplates();
  const zones = useMemo(() => timeZones(settings.timezone), [settings.timezone]);
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const result = validate(workspaceSettingsInput, values);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(values);
      toast({ title: "Settings saved", tone: "success" });
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not save the settings");
    }
  };

  const disabled = readOnly;
  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Section title="Workspace">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Workspace name"
            className="sm:col-span-2"
            isDisabled={disabled}
            value={values.name}
            onChange={(name) => set("name", name)}
            {...fieldError(errors, "name")}
          />
          <ComboBox
            label="Home currency"
            isDisabled={disabled || settings.homeCurrencyLocked}
            defaultItems={CURRENCY_CODES.map((code) => ({ id: code }))}
            value={values.homeCurrency}
            onChange={(key) => key !== null && set("homeCurrency", String(key))}
            description={
              settings.homeCurrencyLocked
                ? "The home currency cannot change after the first invoice or quote was finalized."
                : "Reports convert every amount to this currency."
            }
            {...fieldError(errors, "homeCurrency")}
          >
            {(item: { id: string }) => <ListBoxItem id={item.id}>{item.id}</ListBoxItem>}
          </ComboBox>
          <ComboBox
            label="Time zone"
            isDisabled={disabled}
            defaultItems={zones.map((zone) => ({ id: zone }))}
            value={values.timezone}
            onChange={(key) => key !== null && set("timezone", String(key))}
            description="Due dates and the scheduler use this time zone."
            {...fieldError(errors, "timezone")}
          >
            {(item: { id: string }) => <ListBoxItem id={item.id}>{item.id}</ListBoxItem>}
          </ComboBox>
        </div>
      </Section>

      <Section
        title="Numbering"
        description="Numbers are given when a document is first sent. They never have gaps."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Invoice prefix"
            isDisabled={disabled}
            value={values.invoicePrefix}
            onChange={(text) => set("invoicePrefix", text)}
            description={`Example: ${exampleNumber(values.invoicePrefix, values.numberPadding || 1, 42)}`}
            {...fieldError(errors, "invoicePrefix")}
          />
          <TextField
            label="Quote prefix"
            isDisabled={disabled}
            value={values.quotePrefix}
            onChange={(text) => set("quotePrefix", text)}
            description={`Example: ${exampleNumber(values.quotePrefix, values.numberPadding || 1, 12)}`}
            {...fieldError(errors, "quotePrefix")}
          />
          <NumberField
            label="Digits"
            isDisabled={disabled}
            minValue={1}
            maxValue={8}
            step={1}
            showStepper
            value={values.numberPadding}
            onChange={(n) => set("numberPadding", n)}
            {...fieldError(errors, "numberPadding")}
          />
        </div>
      </Section>

      <Section title="Document defaults" description="Clients can override these.">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Payment terms (days)"
            isDisabled={disabled}
            minValue={0}
            maxValue={365}
            step={1}
            value={values.defaultPaymentTermsDays}
            onChange={(n) => set("defaultPaymentTermsDays", n)}
            {...fieldError(errors, "defaultPaymentTermsDays")}
          />
          <NumberField
            label="Quotes valid for (days)"
            isDisabled={disabled}
            minValue={1}
            maxValue={365}
            step={1}
            value={values.defaultQuoteValidityDays}
            onChange={(n) => set("defaultQuoteValidityDays", n)}
            {...fieldError(errors, "defaultQuoteValidityDays")}
          />
          <Select
            label="Default template"
            isDisabled={disabled}
            value={values.defaultTemplateId ?? NONE}
            onChange={(key) =>
              set("defaultTemplateId", key === NONE || key === null ? null : String(key))
            }
            {...fieldError(errors, "defaultTemplateId")}
          >
            <ListBoxItem id={NONE}>Built-in classic layout</ListBoxItem>
            {(templates.data ?? []).map((template) => (
              <ListBoxItem key={template.id} id={template.id}>
                {template.name}
              </ListBoxItem>
            ))}
          </Select>
          <Select
            label="Default tax rate"
            isDisabled={disabled}
            value={values.defaultTaxRateId ?? NONE}
            onChange={(key) =>
              set("defaultTaxRateId", key === NONE || key === null ? null : String(key))
            }
            {...fieldError(errors, "defaultTaxRateId")}
          >
            <ListBoxItem id={NONE}>No tax</ListBoxItem>
            {(taxRates.data ?? []).map((rate) => (
              <ListBoxItem key={rate.id} id={rate.id}>
                {taxRateLabel(rate)}
              </ListBoxItem>
            ))}
          </Select>
        </div>
      </Section>

      <Section title="Email" description="How document and reminder emails show to clients.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Sender name"
            isDisabled={disabled}
            value={values.emailFromName ?? ""}
            onChange={(text) => set("emailFromName", text)}
            {...fieldError(errors, "emailFromName")}
          />
          <TextField
            label="Sender email"
            type="email"
            description="Use an address on a domain you verified in Resend."
            isDisabled={disabled}
            value={values.emailFromAddress ?? ""}
            onChange={(text) => set("emailFromAddress", text)}
            {...fieldError(errors, "emailFromAddress")}
          />
          <TextField
            label="Reply-to email"
            type="email"
            isDisabled={disabled}
            value={values.replyToEmail ?? ""}
            onChange={(text) => set("replyToEmail", text)}
            {...fieldError(errors, "replyToEmail")}
          />
        </div>
      </Section>

      {readOnly ? null : (
        <SaveBar>
          <Button type="submit" isPending={update.isPending}>
            Save settings
          </Button>
        </SaveBar>
      )}
    </Form>
  );
}
