import { useEffect, useState } from "react";
import { REMINDER_MODE_SETTINGS, type ReminderModeSetting } from "../../../shared/domain";
import { CURRENCY_CODES, normalizePercent } from "../../../shared/money";
import {
  type ClientDetail,
  type ClientSummary,
  OWNER_ONLY_MESSAGE,
  REMINDER_MODE_LABELS,
} from "../../../shared/schemas/client";
import { documentCreateInput, documentUpdateInput } from "../../../shared/schemas/document";
import type { TaxRate } from "../../../shared/schemas/tax-rate";
import type { CustomFieldDef, TemplateSummary } from "../../../shared/schemas/template";
import { addDays } from "../../../shared/time";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { ComboBox } from "../../components/ui/combo-box";
import { IsoDatePicker } from "../../components/ui/date-picker";
import { ListBoxItem } from "../../components/ui/list-box";
import { MoneyField } from "../../components/ui/money-field";
import { Section } from "../../components/ui/section";
import { Segment, SegmentedControl } from "../../components/ui/segmented-control";
import { Select } from "../../components/ui/select";
import { TextArea, TextField } from "../../components/ui/text-field";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { formatDate } from "../../lib/format";
import { changeCurrency, type EditorValues, editorTotals, toDocumentInput } from "./editor-state";
import { FxPanel } from "./fx-panel";
import { LineItems } from "./line-items";
import { TotalsPanel } from "./totals-panel";

const NONE = "__none";

export type EditorMode = "create" | "edit" | "revise";
export type SaveIntent = "save" | "send" | "revise";

export interface WorkspaceDefaults {
  homeCurrency: string;
  paymentTermsDays: number;
  quoteValidityDays: number;
  taxRateId: string | null;
  templateId: string | null;
}

export interface DocumentEditorProps {
  mode: EditorMode;
  initialValues: EditorValues;
  /** The page title, for example "New invoice" or "Revise invoice INV-0042". */
  title: string;
  clients: ClientSummary[];
  taxRates: TaxRate[];
  templates: TemplateSummary[];
  customFieldDefs: CustomFieldDef[];
  isOwner: boolean;
  defaults: WorkspaceDefaults;
  /** Today in the workspace timezone. */
  today: string;
  /** Loads a client's defaults when the client changes. */
  loadClient: (id: string) => Promise<ClientDetail>;
  /**
   * Saves the values. The editor keeps its values whatever happens, so a server error never
   * loses edits. Return field errors from the server to show them.
   */
  onSave: (values: EditorValues, intent: SaveIntent) => Promise<FieldErrors | undefined>;
  onCancel: () => void;
}

type ClientDefaults = Pick<
  ClientDetail["client"],
  "defaultTaxRateId" | "paymentTermsDays" | "templateId" | "defaultCurrency"
>;

/**
 * The quote and invoice editor. Totals update on every change with the shared money engine,
 * so they match what the server stores.
 */
export function DocumentEditor({
  mode,
  initialValues,
  title,
  clients,
  taxRates,
  templates,
  customFieldDefs,
  isOwner,
  defaults,
  today,
  loadClient,
  onSave,
  onCancel,
}: DocumentEditorProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<SaveIntent | null>(null);
  const [client, setClient] = useState<ClientDefaults | null>(null);
  const set = <K extends keyof EditorValues>(key: K, value: EditorValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const isInvoice = values.kind === "invoice";
  const { totals, discountError } = editorTotals(values, taxRates);
  const issueDate = values.issueDate ?? today;
  const defaultTaxRateId = client?.defaultTaxRateId ?? defaults.taxRateId;

  // Load the defaults of the client the document already has.
  const initialClientId = initialValues.clientId;
  useEffect(() => {
    if (!initialClientId) return;
    let live = true;
    loadClient(initialClientId)
      .then((detail) => live && setClient(detail.client))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [initialClientId, loadClient]);

  const chooseClient = async (id: string | null) => {
    set("clientId", id);
    if (!id) return;
    try {
      const detail = await loadClient(id);
      const previousTax = client?.defaultTaxRateId ?? defaults.taxRateId;
      const nextTax = detail.client.defaultTaxRateId ?? defaults.taxRateId;
      setClient(detail.client);
      setValues((current) => {
        let next: EditorValues = {
          ...current,
          clientId: id,
          // A line still on the old default tax follows the new client's default.
          lines: current.lines.map((line) =>
            line.taxRateId === previousTax ? { ...line, taxRateId: nextTax } : line,
          ),
        };
        if (mode !== "revise") next = changeCurrency(next, detail.client.defaultCurrency);
        return next;
      });
    } catch {
      // The client stays selected. The defaults fill in when the server answers next time.
    }
  };

  const save = async (intent: SaveIntent) => {
    const input = toDocumentInput(values);
    const schema = mode === "create" ? documentCreateInput : documentUpdateInput;
    const result = validate(schema, input);
    const nextErrors: FieldErrors = { ...(result.errors ?? {}) };
    if (!values.clientId) nextErrors.clientId = "Choose a client";
    if (discountError) nextErrors.discount = discountError;
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setPending(intent);
    try {
      const serverErrors = await onSave(values, intent);
      if (serverErrors) setErrors(serverErrors);
    } finally {
      setPending(null);
    }
  };

  const clientOptions = clients.filter((c) => c.archivedAt === null || c.id === values.clientId);
  const termsDefault = client?.paymentTermsDays ?? defaults.paymentTermsDays;
  const templateDefaultId = client?.templateId ?? defaults.templateId;
  const templateDefaultName = templates.find((t) => t.id === templateDefaultId)?.name ?? "Standard";
  const docFields = customFieldDefs.filter((d) => d.scope === "document" && d.archivedAt === null);

  const lockedReminder = !isOwner && initialValues.reminderMode === "auto_send";
  const reminderNote = isOwner
    ? undefined
    : lockedReminder
      ? OWNER_ONLY_MESSAGE
      : "Only an Owner can turn on auto-send";

  const saveLabel =
    mode === "revise" ? "Save revision" : mode === "create" ? "Save draft" : "Save changes";

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          mode === "revise"
            ? "Saving creates a new revision. The public link shows the latest one."
            : undefined
        }
        actions={
          <>
            <Button variant="secondary" onPress={onCancel}>
              Cancel
            </Button>
            {mode === "revise" ? (
              <Button isPending={pending === "revise"} onPress={() => void save("revise")}>
                {saveLabel}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  isPending={pending === "save"}
                  isDisabled={pending !== null}
                  onPress={() => void save("save")}
                >
                  {saveLabel}
                </Button>
                <Button
                  isPending={pending === "send"}
                  isDisabled={pending !== null}
                  onPress={() => void save("send")}
                >
                  Save and send
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <ComboBox
                label="Client"
                isRequired
                placeholder="Choose a client"
                defaultItems={clientOptions}
                value={values.clientId}
                onChange={(key) => void chooseClient(key === null ? null : String(key))}
                {...fieldError(errors, "clientId")}
              >
                {(item: ClientSummary) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
              </ComboBox>
              <Select
                label="Currency"
                value={values.currency}
                onChange={(key) => key && setValues((v) => changeCurrency(v, String(key)))}
                description={
                  client && values.currency !== client.defaultCurrency
                    ? `The client usually pays in ${client.defaultCurrency}.`
                    : undefined
                }
                items={CURRENCY_CODES.map((code) => ({ id: code }))}
                {...fieldError(errors, "currency")}
              >
                {(item: { id: string }) => <ListBoxItem id={item.id}>{item.id}</ListBoxItem>}
              </Select>
              <IsoDatePicker
                label="Issue date"
                value={values.issueDate}
                onChange={(date) => set("issueDate", date)}
                description="Leave empty to use the send date."
                {...fieldError(errors, "issueDate")}
              />
              {isInvoice ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span id="due-label" className="text-[13px] font-medium text-ink">
                      Due
                    </span>
                    <SegmentedControl
                      aria-labelledby="due-label"
                      selectedKey={values.dueMode}
                      onSelectionChange={(key) => set("dueMode", key as EditorValues["dueMode"])}
                    >
                      <Segment id="terms">Terms</Segment>
                      <Segment id="date">Date</Segment>
                    </SegmentedControl>
                  </div>
                  {values.dueMode === "terms" ? (
                    <TextField
                      aria-label="Payment terms (days)"
                      inputMode="numeric"
                      placeholder={`${termsDefault} days`}
                      value={values.paymentTermsDays}
                      onChange={(days) => /^\d{0,3}$/.test(days) && set("paymentTermsDays", days)}
                      description={`Days after the issue date. Empty uses ${termsDefault} days${client?.paymentTermsDays != null ? " from the client" : ""}: due ${formatDate(addDays(issueDate, Number(values.paymentTermsDays || termsDefault)))}.`}
                      inputClassName="figure"
                      {...fieldError(errors, "paymentTermsDays")}
                    />
                  ) : (
                    <IsoDatePicker
                      aria-label="Due date"
                      value={values.dueDate}
                      onChange={(date) => set("dueDate", date)}
                      {...fieldError(errors, "dueDate")}
                    />
                  )}
                </div>
              ) : (
                <IsoDatePicker
                  label="Expiry date"
                  value={values.expiryDate}
                  onChange={(date) => set("expiryDate", date)}
                  description={`Leave empty for ${defaults.quoteValidityDays} days after the issue date.`}
                  {...fieldError(errors, "expiryDate")}
                />
              )}
            </div>
          </Section>

          <Section title="Line items" description="Prices exclude tax.">
            <LineItems
              lines={values.lines}
              currency={values.currency}
              taxRates={taxRates}
              defaultTaxRateId={defaultTaxRateId}
              totals={totals}
              onChange={(lines) => set("lines", lines)}
              errors={errors}
            />
          </Section>

          <Section title="Notes and fields">
            <div className="flex flex-col gap-4">
              <TextArea
                label="Notes"
                description="Printed on the document."
                rows={3}
                value={values.notes}
                onChange={(notes) => set("notes", notes)}
                {...fieldError(errors, "notes")}
              />
              {docFields.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {docFields.map((def) =>
                    def.type === "date" ? (
                      <IsoDatePicker
                        key={def.id}
                        label={def.label}
                        value={values.customFields[def.id] || null}
                        onChange={(date) =>
                          set("customFields", { ...values.customFields, [def.id]: date ?? "" })
                        }
                      />
                    ) : (
                      <TextField
                        key={def.id}
                        label={def.label}
                        inputMode={def.type === "number" ? "decimal" : undefined}
                        value={values.customFields[def.id] ?? ""}
                        onChange={(text) =>
                          set("customFields", { ...values.customFields, [def.id]: text })
                        }
                      />
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
          <Section title="Totals">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span id="discount-label" className="text-[13px] font-medium text-ink">
                  Discount
                </span>
                <SegmentedControl
                  aria-labelledby="discount-label"
                  selectedKey={values.discountType}
                  onSelectionChange={(key) =>
                    set("discountType", key as EditorValues["discountType"])
                  }
                >
                  <Segment id="none">None</Segment>
                  <Segment id="percent">Percent</Segment>
                  <Segment id="fixed">Fixed</Segment>
                </SegmentedControl>
                {values.discountType === "percent" ? (
                  <TextField
                    aria-label="Discount percent"
                    inputMode="decimal"
                    placeholder="%"
                    value={values.discountPercent}
                    onChange={(text) =>
                      /^\d{0,3}(\.\d{0,4})?$/.test(text) && set("discountPercent", text)
                    }
                    inputClassName="figure text-right"
                    isInvalid={Boolean(errors.discount ?? discountError)}
                    errorMessage={errors.discount ?? discountError ?? undefined}
                  />
                ) : values.discountType === "fixed" ? (
                  <MoneyField
                    aria-label={`Discount amount (${values.currency})`}
                    currency={values.currency}
                    value={values.discountAmount}
                    onChange={(text) => set("discountAmount", text)}
                    isInvalid={Boolean(errors.discount ?? discountError)}
                    errorMessage={errors.discount ?? discountError ?? undefined}
                  />
                ) : null}
              </div>
              <TotalsPanel totals={totals} discountLabel={discountLabel(values)} />
            </div>
          </Section>

          <Section title="Exchange rate">
            <FxPanel
              currency={values.currency}
              homeCurrency={defaults.homeCurrency}
              issueDate={issueDate}
              manual={values.fxManual}
              onManualChange={(manual) => set("fxManual", manual)}
            />
          </Section>

          <Section title="Delivery">
            <div className="flex flex-col gap-4">
              <Select
                label="Template"
                value={values.templateId ?? NONE}
                onChange={(key) =>
                  set("templateId", key === NONE || key === null ? null : String(key))
                }
              >
                <ListBoxItem id={NONE} textValue={`Default (${templateDefaultName})`}>
                  Default ({templateDefaultName})
                </ListBoxItem>
                {templates.map((template) => (
                  <ListBoxItem key={template.id} id={template.id}>
                    {template.name}
                  </ListBoxItem>
                ))}
              </Select>
              {isInvoice ? (
                <Select
                  label="Reminders"
                  value={values.reminderMode}
                  isDisabled={lockedReminder}
                  disabledKeys={isOwner ? undefined : ["auto_send"]}
                  onChange={(key) => key && set("reminderMode", key as ReminderModeSetting)}
                  description={reminderNote}
                  {...fieldError(errors, "reminderMode")}
                >
                  {REMINDER_MODE_SETTINGS.map((m) => (
                    <ListBoxItem key={m} id={m}>
                      {m === "inherit" ? "Client or workspace default" : REMINDER_MODE_LABELS[m]}
                    </ListBoxItem>
                  ))}
                </Select>
              ) : null}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function discountLabel(values: EditorValues): string {
  if (values.discountType !== "percent") return "Discount";
  try {
    return `Discount ${normalizePercent(values.discountPercent)}%`;
  } catch {
    return "Discount";
  }
}
