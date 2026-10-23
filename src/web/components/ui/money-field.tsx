import { getExponent, isCurrencyCode } from "../../../shared/money";
import { TextField, type TextFieldProps } from "./text-field";
import { cn } from "./utils";

/** The number of decimals a currency allows. Unknown codes get 2. */
export function currencyDecimals(currency: string): number {
  return isCurrencyCode(currency) ? getExponent(currency) : 2;
}

/** True when `text` is a partial or complete amount with at most `decimals` decimals. */
export function isAmountText(text: string, decimals: number): boolean {
  if (decimals === 0) return /^\d*$/.test(text);
  return new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`).test(text);
}

/** Cuts extra decimals, for example "12.50" to "12" for JPY. */
export function fitAmountText(text: string, decimals: number): string {
  const [whole = "", fraction] = text.split(".");
  if (fraction === undefined) return whole;
  if (decimals === 0) return whole;
  return `${whole}.${fraction.slice(0, decimals)}`;
}

export interface MoneyFieldProps extends Omit<TextFieldProps, "value" | "onChange"> {
  /** ISO 4217 code. It sets how many decimals the field accepts. */
  currency: string;
  /** The amount in major units as typed, for example "1500.5". */
  value: string;
  onChange: (value: string) => void;
}

/**
 * An amount input in major units. It accepts only digits and as many decimals as the
 * currency allows (none for JPY). Convert with `parseMinor` from the shared money module.
 */
export function MoneyField({
  currency,
  value,
  onChange,
  inputClassName,
  ...props
}: MoneyFieldProps) {
  const decimals = currencyDecimals(currency);
  return (
    <TextField
      {...props}
      inputMode={decimals === 0 ? "numeric" : "decimal"}
      autoComplete="off"
      value={value}
      onChange={(next) => {
        const text = next.replace(/,/g, "").trim();
        if (isAmountText(text, decimals)) onChange(text);
      }}
      inputClassName={cn("figure text-right", inputClassName)}
    />
  );
}
