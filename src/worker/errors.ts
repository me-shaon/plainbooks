import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError, type z } from "zod";
import { MoneyError } from "../shared/money";

/**
 * A domain error with an HTTP status and a stable code. Services throw it. The error
 * handler turns it into `{ error, code }` JSON.
 */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    /** Field problems, sent as `issues` like a validation error. */
    readonly issues?: ErrorBody["issues"],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ErrorBody {
  error: string;
  code?: string;
  issues?: { path: string; message: string }[];
}

/** Hono `onError` handler. Known errors become 4xx JSON. Others become a generic 500. */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    const body: ErrorBody = { error: err.message, code: err.code };
    if (err.issues) body.issues = err.issues;
    return c.json<ErrorBody>(body, err.status);
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return c.json<ErrorBody>({ error: "Invalid request", code: "invalid_request", issues }, 400);
  }
  if (err instanceof MoneyError) {
    return c.json<ErrorBody>({ error: err.message, code: "invalid_amount" }, 400);
  }
  if (err instanceof HTTPException) {
    if (err.res) return err.res;
    return c.json<ErrorBody>({ error: err.message || "Request failed" }, err.status);
  }
  console.error(err);
  return c.json<ErrorBody>({ error: "Internal server error" }, 500);
}

/**
 * Parses the JSON body with a Zod schema. A Content-Type other than application/json
 * becomes a 415, so a cross-site form cannot send JSON as text/plain. Invalid JSON or
 * data becomes a 400.
 */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const mediaType = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new AppError(415, "unsupported_media_type", "The request body must be application/json");
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError(400, "invalid_json", "The request body must be valid JSON");
  }
  return schema.parse(body);
}
