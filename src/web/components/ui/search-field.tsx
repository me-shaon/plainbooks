import { Search, X } from "lucide-react";
import {
  Input,
  Button as RACButton,
  SearchField as RACSearchField,
  type SearchFieldProps as RACSearchFieldProps,
} from "react-aria-components";
import { inputBox, Label } from "./field";
import { cn, composeTailwind, focusRing } from "./utils";

export interface SearchFieldProps extends RACSearchFieldProps {
  label?: string;
  placeholder?: string;
}

/** A search input with a clear button. Escape clears it. */
export function SearchField({ label, placeholder, className, ...props }: SearchFieldProps) {
  return (
    <RACSearchField
      {...props}
      className={composeTailwind(className, "group flex flex-col gap-1.5")}
    >
      {label ? <Label>{label}</Label> : null}
      <div
        className={cn(
          inputBox,
          "relative flex items-center gap-2 px-0 group-data-[focused]:border-accent group-data-[focused]:ring-3 group-data-[focused]:ring-accent/20",
        )}
      >
        <Search className="ml-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          placeholder={placeholder}
          className="min-w-0 flex-1 self-stretch bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        <RACButton
          className={cn(
            "mr-1 flex size-8 shrink-0 items-center justify-center rounded-small text-muted-foreground hover:bg-segmented group-data-[empty]:hidden",
            focusRing,
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </RACButton>
      </div>
    </RACSearchField>
  );
}
