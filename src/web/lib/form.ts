import type { z } from "zod";

export type FieldErrors = Record<string, string>;

/** The first message per field path, for example { "contacts.0.email": "Enter a valid email" }. */
export function zodErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".");
    result[path] ??= issue.message;
  }
  return result;
}

/**
 * Validates form values with a shared schema. Returns the parsed data, or the field errors.
 */
export function validate<T extends z.ZodType>(
  schema: T,
  values: unknown,
): { data: z.output<T>; errors: null } | { data: null; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data, errors: null };
  return { data: null, errors: zodErrors(result.error) };
}

/** Props that show a field's error. Spread them on a TextField, Select, or NumberField. */
export function fieldError(errors: FieldErrors, path: string) {
  const message = errors[path];
  return { isInvalid: Boolean(message), errorMessage: message };
}
