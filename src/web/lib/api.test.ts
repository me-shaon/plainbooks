import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

/** A fetch that never answers, but stops when its signal aborts, like the browser's. */
function stalledFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("fails a request that gets no answer in time", async () => {
    vi.stubGlobal("fetch", stalledFetch());
    const call = api("/templates/x", { timeoutMs: 20 });
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toThrow("The server took too long to answer");
  });

  it("reports a cancel by the caller as a cancel, not a timeout", async () => {
    vi.stubGlobal("fetch", stalledFetch());
    const controller = new AbortController();
    const call = api("/templates/x", { signal: controller.signal, timeoutMs: 10_000 });
    controller.abort();
    await expect(call).rejects.toThrow("could not be reached");
  });
});
