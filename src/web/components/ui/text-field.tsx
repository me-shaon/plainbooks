import {
  Input,
  TextArea as RACTextArea,
  TextField as RACTextField,
  type TextFieldProps as RACTextFieldProps,
} from "react-aria-components";
import { Description, FieldError, type FieldTextProps, fieldStack, inputBox, Label } from "./field";
import { cn, composeTailwind } from "./utils";

export interface TextFieldProps extends RACTextFieldProps, FieldTextProps {
  placeholder?: string;
  inputClassName?: string;
}

export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  inputClassName,
  className,
  ...props
}: TextFieldProps) {
  return (
    <RACTextField {...props} className={composeTailwind(className, fieldStack)}>
      {label ? <Label>{label}</Label> : null}
      <Input placeholder={placeholder} className={cn(inputBox, inputClassName)} />
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </RACTextField>
  );
}

export interface TextAreaProps extends RACTextFieldProps, FieldTextProps {
  placeholder?: string;
  rows?: number;
  inputClassName?: string;
}

export function TextArea({
  label,
  description,
  errorMessage,
  placeholder,
  rows = 4,
  inputClassName,
  className,
  ...props
}: TextAreaProps) {
  return (
    <RACTextField {...props} className={composeTailwind(className, fieldStack)}>
      {label ? <Label>{label}</Label> : null}
      <RACTextArea
        placeholder={placeholder}
        rows={rows}
        className={cn(inputBox, "resize-y py-2.5 leading-normal", inputClassName)}
      />
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </RACTextField>
  );
}
