import { Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextArea } from "../../components/ui/text-field";

/** The most characters a footer may have (brandKitInput.footerText). */
export const FOOTER_MAX_LENGTH = 1000;

/** Lines that many footers use. Each one adds itself on a new line. */
export const FOOTER_SUGGESTIONS = [
  "Thank you for your business.",
  "Please include the invoice number with your payment.",
  "Payment is due by the due date shown above.",
  "Questions about this document? Reply to the email it came with.",
] as const;

/** `text` with `line` added on a new line. */
export function addFooterLine(text: string, line: string): string {
  const current = text.trimEnd();
  return current ? `${current}\n${line}` : line;
}

/**
 * The default footer: a text area with a character count, and buttons that add common
 * lines. The footer prints at the bottom of every document as plain text.
 */
export function FooterField({
  value,
  onChange,
  isDisabled,
  errorProps,
}: {
  value: string;
  onChange: (text: string) => void;
  isDisabled?: boolean;
  errorProps?: { isInvalid?: boolean; errorMessage?: string };
}) {
  const unused = FOOTER_SUGGESTIONS.filter((line) => !value.includes(line));
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <TextArea
        label="Default footer"
        rows={3}
        maxLength={FOOTER_MAX_LENGTH}
        isDisabled={isDisabled}
        placeholder="For example: Thank you for your business."
        value={value}
        onChange={onChange}
        description={
          <span className="flex justify-between gap-3">
            <span>
              Prints at the bottom of every invoice and quote. One document can change it.
            </span>
            <span className="figure shrink-0">
              {value.length} / {FOOTER_MAX_LENGTH}
            </span>
          </span>
        }
        {...errorProps}
      />
      {isDisabled || unused.length === 0 ? null : (
        <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
          <legend className="float-left mr-1 p-0 text-xs text-muted-foreground">Add a line:</legend>
          {unused.map((line) => (
            <Button
              key={line}
              variant="secondary"
              size="sm"
              className="h-auto max-w-full shrink rounded-pill py-1.5 text-left font-normal whitespace-normal"
              onPress={() => onChange(addFooterLine(value, line).slice(0, FOOTER_MAX_LENGTH))}
            >
              <Plus className="size-3.5 shrink-0" aria-hidden="true" />
              {line}
            </Button>
          ))}
        </fieldset>
      )}
    </div>
  );
}
