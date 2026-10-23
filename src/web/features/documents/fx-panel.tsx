import { CircleAlert } from "lucide-react";
import { normalizeRate } from "../../../shared/money";
import type { FxQuote } from "../../../shared/schemas/document";
import { IsoDatePicker } from "../../components/ui/date-picker";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { TextField } from "../../components/ui/text-field";
import { formatDate } from "../../lib/format";
import { FX_PROVIDER_LABELS } from "./labels";
import { useFxRate } from "./queries";

export interface FxPanelProps {
  currency: string;
  homeCurrency: string;
  /** The issue date the send would use (the typed date, or today). */
  issueDate: string;
  manual: { rate: string; date: string } | null;
  onManualChange: (manual: { rate: string; date: string } | null) => void;
  isDisabled?: boolean;
}

/** True when the send must wait for a manual rate. */
export function fxBlocksSend(
  quote: FxQuote | null | undefined,
  manual: { rate: string } | null,
): boolean {
  if (manual) return !isValidRate(manual.rate);
  return quote?.status === "manual_required";
}

export function isValidRate(text: string): boolean {
  try {
    return normalizeRate(text) !== "0";
  } catch {
    return false;
  }
}

/** One line such as "1 EUR = 128.5 BDT". */
export function rateText(rate: string, currency: string, homeCurrency: string): string {
  return `1 ${currency} = ${rate} ${homeCurrency}`;
}

/**
 * The exchange rate to the home currency: the fetched rate with its date and provider, or a
 * manual rate the user types. Send is blocked while the rate is missing.
 */
export function FxPanel({
  currency,
  homeCurrency,
  issueDate,
  manual,
  onManualChange,
  isDisabled,
}: FxPanelProps) {
  const foreign = currency !== homeCurrency;
  const fetched = useFxRate(currency, issueDate, foreign && !manual);

  if (!foreign) {
    return (
      <p className="m-0 text-[13px] text-muted-foreground">
        This document is in the home currency ({homeCurrency}). It needs no exchange rate.
      </p>
    );
  }

  const quote = fetched.data;
  return (
    <div className="flex flex-col gap-3">
      {manual ? null : fetched.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : quote?.status === "ok" ? (
        <div className="flex flex-col gap-0.5">
          <span className="figure text-sm text-ink">
            {rateText(quote.rate, currency, homeCurrency)}
          </span>
          <span className="text-xs text-muted-foreground">
            Fetched for {formatDate(quote.rateDate)} · {FX_PROVIDER_LABELS[quote.provider]}
          </span>
        </div>
      ) : (
        <p
          role="alert"
          className="m-0 flex items-start gap-2 rounded-button bg-danger-tint px-3 py-2.5 text-[13px] text-danger-tint-foreground"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {quote?.status === "manual_required" ? `${quote.message.replace(/\.?$/, ".")} ` : ""}
            Enter a manual rate before you send.
          </span>
        </p>
      )}

      <Switch
        isSelected={manual !== null}
        isDisabled={isDisabled}
        onChange={(on) =>
          onManualChange(
            on ? { rate: quote?.status === "ok" ? quote.rate : "", date: issueDate } : null,
          )
        }
      >
        Use a manual rate
      </Switch>

      {manual ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={`Rate (1 ${currency} in ${homeCurrency})`}
            description="Manual"
            inputMode="decimal"
            isDisabled={isDisabled}
            value={manual.rate}
            onChange={(rate) => onManualChange({ ...manual, rate: rate.trim() })}
            inputClassName="figure"
            isInvalid={manual.rate !== "" && !isValidRate(manual.rate)}
            errorMessage="Enter a rate above 0 with 8 decimals at most"
          />
          <IsoDatePicker
            label="Rate date"
            isDisabled={isDisabled}
            value={manual.date}
            onChange={(date) => onManualChange({ ...manual, date: date ?? issueDate })}
          />
        </div>
      ) : null}
    </div>
  );
}
