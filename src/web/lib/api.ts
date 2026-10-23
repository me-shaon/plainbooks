import { toast } from "../components/ui/toast";

export interface ApiIssue {
  path: string;
  message: string;
}

/** A failed API call. `code` and `issues` come from the Worker's error JSON. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** A JSON body. */
  json?: unknown;
  /** A raw body, for example a file. Set `contentType` with it. */
  body?: BodyInit;
  contentType?: string;
  /** Query string values. Undefined and empty values are left out. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /**
   * Shows a toast when the call fails. On by default for writes. Queries report errors
   * through the QueryCache handler in main.tsx instead.
   */
  toastOnError?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query: ApiOptions["query"]): string {
  const url = `/api${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${url}?${text}` : url;
}

/** Shows an API error as a toast. */
export function toastError(err: unknown, title = "Something went wrong"): void {
  const description = err instanceof Error ? err.message : undefined;
  toast({ title, description, tone: "danger" });
}

/**
 * Calls the Worker API and returns the parsed JSON. `path` starts after `/api`.
 *
 * ```ts
 * const { items } = await api<{ items: ClientSummary[] }>("/clients", { query: { q } });
 * await api("/clients", { method: "POST", json: input });
 * ```
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers({ accept: "application/json" });
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  } else if (options.contentType) {
    headers.set("content-type", options.contentType);
  }

  const toastOnError = options.toastOnError ?? method !== "GET";
  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    const error = new ApiError(0, "The server could not be reached. Check your connection.");
    if (toastOnError && !(err instanceof DOMException && err.name === "AbortError")) {
      toastError(error);
    }
    throw error;
  }

  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const info = (data ?? {}) as { error?: string; code?: string; issues?: ApiIssue[] };
    const error = new ApiError(
      res.status,
      info.error ?? `Request failed (${res.status})`,
      info.code,
      info.issues ?? [],
    );
    if (toastOnError) toastError(error, "Could not save");
    throw error;
  }
  return data as T;
}

/** Field errors from a 400 response, keyed by the dotted field path. */
export function issuesByPath(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const result: Record<string, string> = {};
  for (const issue of err.issues) {
    result[issue.path] ??= issue.message;
  }
  return result;
}
