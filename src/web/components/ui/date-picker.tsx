import { type CalendarDate, parseDate } from "@internationalized/date";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import {
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  type CalendarProps,
  DateInput,
  DateSegment,
  type DateValue,
  Dialog,
  Group,
  Heading,
  Button as RACButton,
  Calendar as RACCalendar,
  DatePicker as RACDatePicker,
  type DatePickerProps as RACDatePickerProps,
} from "react-aria-components";
import { Description, FieldError, type FieldTextProps, fieldStack, inputBox, Label } from "./field";
import { Popover } from "./popover";
import { cn, composeTailwind, focusRing } from "./utils";

const navButton = cn(
  "flex size-9 items-center justify-center rounded-small text-ink hover:bg-segmented pressed:bg-[#e6e9e6]",
  focusRing,
);

export function Calendar<T extends DateValue>({ className, ...props }: CalendarProps<T>) {
  return (
    <RACCalendar {...props} className={composeTailwind(className, "w-fit p-3")}>
      <header className="mb-2 flex items-center gap-1">
        <RACButton slot="previous" className={navButton}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </RACButton>
        <Heading className="flex-1 text-center text-sm font-semibold" />
        <RACButton slot="next" className={navButton}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </RACButton>
      </header>
      <CalendarGrid className="border-separate border-spacing-0.5">
        <CalendarGridHeader>
          {(day) => (
            <CalendarHeaderCell className="pb-1 text-xs font-medium text-muted-foreground">
              {day}
            </CalendarHeaderCell>
          )}
        </CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (
            <CalendarCell
              date={date}
              className={({ isSelected, isOutsideMonth, isDisabled, isUnavailable }) =>
                cn(
                  "figure flex size-9 cursor-default items-center justify-center rounded-small text-[13px] outline-none",
                  "hover:bg-segmented data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-1 data-[focus-visible]:outline-ring",
                  isOutsideMonth && "text-muted-foreground/50",
                  isSelected && "bg-ink text-ink-foreground hover:bg-ink",
                  (isDisabled || isUnavailable) && "text-muted-foreground/40 line-through",
                )
              }
            />
          )}
        </CalendarGridBody>
      </CalendarGrid>
    </RACCalendar>
  );
}

export interface DatePickerProps<T extends DateValue>
  extends RACDatePickerProps<T>,
    FieldTextProps {}

/** A date input with a calendar popover. Values are `@internationalized/date` objects. */
export function DatePicker<T extends DateValue>({
  label,
  description,
  errorMessage,
  className,
  ...props
}: DatePickerProps<T>) {
  return (
    <RACDatePicker {...props} className={composeTailwind(className, fieldStack)}>
      {label ? <Label>{label}</Label> : null}
      <Group className={cn(inputBox, "flex items-center pr-1")}>
        <DateInput className="figure flex flex-1 text-[13px]">
          {(segment) => (
            <DateSegment
              segment={segment}
              className={cn(
                "rounded-[4px] px-0.5 tabular-nums outline-none caret-transparent",
                "data-[placeholder]:text-muted-foreground data-[type=literal]:px-0",
                "data-[focused]:bg-accent data-[focused]:text-accent-foreground",
              )}
            />
          )}
        </DateInput>
        <RACButton className={cn(navButton, "size-9 text-muted-foreground md:size-8")}>
          <CalendarIcon className="size-4" aria-hidden="true" />
        </RACButton>
      </Group>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover>
        <Dialog className="outline-none">
          <Calendar />
        </Dialog>
      </Popover>
    </RACDatePicker>
  );
}

export interface IsoDatePickerProps
  extends Omit<DatePickerProps<CalendarDate>, "value" | "onChange" | "defaultValue"> {
  /** An ISO date (YYYY-MM-DD), or null for an empty field. */
  value: string | null;
  onChange: (value: string | null) => void;
}

function toCalendarDate(value: string | null): CalendarDate | null {
  if (!value) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

/** A DatePicker that reads and writes ISO date strings. */
export function IsoDatePicker({ value, onChange, ...props }: IsoDatePickerProps) {
  return (
    <DatePicker<CalendarDate>
      {...props}
      value={toCalendarDate(value)}
      onChange={(date) => onChange(date ? date.toString() : null)}
    />
  );
}
