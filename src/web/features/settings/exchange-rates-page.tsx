import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import { CURRENCY_CODES } from "../../../shared/money";
import {
  type ExchangeRates,
  exchangeRatesInput,
  MAX_EXCHANGE_RATES,
} from "../../../shared/schemas/settings";
import { Button } from "../../components/ui/button";
import { ComboBox } from "../../components/ui/combo-box";
import { ListBoxItem } from "../../components/ui/list-box";
import { Section } from "../../components/ui/section";
import { Skeleton } from "../../components/ui/skeleton";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { formatDate } from "../../lib/format";
import { useMe } from "../../lib/session";
import { useExchangeRates, useSaveExchangeRates } from "./queries";
import { SaveBar } from "./settings-layout";

export function ExchangeRatesPage() {
  const rates = useExchangeRates();
  const { isOwner } = useMe();
  if (rates.isPending) return <Skeleton className="h-96 w-full" />;
  if (rates.isError) return null;
  return (
    <ExchangeRatesForm key={JSON.stringify(rates.data)} data={rates.data} readOnly={!isOwner} />
  );
}

interface RateDraft {
  key: string;
  currency: string | null;
  rate: string;
  updatedAt: number | null;
}

function ExchangeRatesForm({ data, readOnly }: { data: ExchangeRates; readOnly: boolean }) {
  const home = data.homeCurrency;
  const [rows, setRows] = useState<RateDraft[]>(() =>
    data.rates.map((r) => ({ key: crypto.randomUUID(), ...r })),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useSaveExchangeRates();
  const options = CURRENCY_CODES.filter((code) => code !== home).map((code) => ({ id: code }));

  const update = (key: string, patch: Partial<RateDraft>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submit = async () => {
    const input = {
      rates: rows.map((row) => ({ currency: row.currency ?? "", rate: row.rate })),
    };
    const result = validate(exchangeRatesInput, input);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync(input);
      toast({ title: "Exchange rates saved", tone: "success" });
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not save the exchange rates");
    }
  };

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Section
        title="Exchange rates"
        description={`Rates to your home currency (${home}). A document in one of these currencies uses your rate. Other currencies use the online provider. A document keeps the rate it had when it got its number, so a change here does not change those documents.`}
      >
        <div className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <p className="m-0 text-[13px] text-muted-foreground">
              No rates set. Every currency uses the online provider.
            </p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {rows.map((row, index) => (
              <li key={row.key} className="flex flex-wrap items-start gap-3">
                <ComboBox
                  label="Currency"
                  isRequired
                  className="w-36"
                  isDisabled={readOnly}
                  defaultItems={options}
                  value={row.currency}
                  onChange={(key) =>
                    update(row.key, { currency: key === null ? null : String(key) })
                  }
                  {...fieldError(errors, `rates.${index}.currency`)}
                >
                  {(item: { id: string }) => <ListBoxItem id={item.id}>{item.id}</ListBoxItem>}
                </ComboBox>
                <TextField
                  label={`Rate (1 ${row.currency ?? "unit"} in ${home})`}
                  isRequired
                  className="w-56"
                  inputMode="decimal"
                  isDisabled={readOnly}
                  value={row.rate}
                  onChange={(rate) => update(row.key, { rate })}
                  description={
                    row.updatedAt
                      ? `Updated ${formatDate(new Date(row.updatedAt).toISOString().slice(0, 10))}`
                      : undefined
                  }
                  {...fieldError(errors, `rates.${index}.rate`)}
                />
                {readOnly ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-6"
                    aria-label={`Remove the ${row.currency ?? "new"} rate`}
                    onPress={() => setRows(rows.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {errors.rates ? (
            <p role="alert" className="m-0 text-xs font-medium text-danger">
              {errors.rates}
            </p>
          ) : null}
          {readOnly || rows.length >= MAX_EXCHANGE_RATES ? null : (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onPress={() =>
                setRows([
                  ...rows,
                  { key: crypto.randomUUID(), currency: null, rate: "", updatedAt: null },
                ])
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              Add rate
            </Button>
          )}
        </div>
      </Section>

      {readOnly ? null : (
        <SaveBar>
          <Button type="submit" isPending={save.isPending}>
            Save exchange rates
          </Button>
        </SaveBar>
      )}
    </Form>
  );
}
