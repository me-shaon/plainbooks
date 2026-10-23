import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../src/worker/db/client";
import { type Fetcher, getRate, manualRate } from "../../src/worker/services/fx";

const db = createDb(env.DB);

interface Call {
  url: string;
  signal?: AbortSignal | null;
}

/** A Frankfurter stub. `respond` maps a request URL to a Response. */
function stubFetcher(respond: (url: URL, call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const call = { url: input, signal: init?.signal };
    calls.push(call);
    return respond(new URL(input), call);
  };
  return { fetcher, calls };
}

/** Publication days for the stub: weekdays only, like ECB-based sources. */
const published: Record<string, number> = {
  "2026-10-01": 122.4567,
  "2026-10-02": 122.5,
};

function frankfurter(url: URL): Response {
  const [, , , from, to] = url.pathname.split("/");
  const requested = url.searchParams.get("date") ?? "2026-10-02";
  const date = Object.keys(published)
    .filter((d) => d <= requested)
    .sort()
    .at(-1);
  if (!date) return Response.json({ status: 404, message: "not found" }, { status: 404 });
  return Response.json({ date, base: from, quote: to, rate: published[date] });
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM fx_rates").run();
});

describe("getRate", () => {
  it("returns the USD to BDT rate for 2026-10-01 and caches it", async () => {
    const { fetcher, calls } = stubFetcher(frankfurter);
    const result = await getRate(db, fetcher, { from: "USD", date: "2026-10-01" });
    expect(result).toEqual({
      status: "ok",
      rate: "122.4567",
      rateScaled: 12245670000,
      rateDate: "2026-10-01",
      provider: "frankfurter",
      cached: false,
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.frankfurter.dev/v2/rate/USD/BDT?date=2026-10-01",
    ]);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    const { results } = await env.DB.prepare("SELECT * FROM fx_rates").all();
    expect(results).toMatchObject([
      {
        base: "USD",
        quote: "BDT",
        requested_date: "2026-10-01",
        rate_date: "2026-10-01",
        rate: "122.4567",
        rate_scaled: 12245670000,
        provider: "frankfurter",
      },
    ]);
  });

  it("returns Friday's rate and effective date for a Saturday", async () => {
    const { fetcher } = stubFetcher(frankfurter);
    const result = await getRate(db, fetcher, { from: "USD", date: "2026-10-03" });
    expect(result).toMatchObject({ status: "ok", rate: "122.5", rateDate: "2026-10-02" });
    const cached = await getRate(db, fetcher, { from: "USD", date: "2026-10-03" });
    expect(cached).toMatchObject({ rateDate: "2026-10-02", cached: true });
  });

  it("makes no network call on a cache hit", async () => {
    const first = stubFetcher(frankfurter);
    await getRate(db, first.fetcher, { from: "USD", date: "2026-10-01" });
    const second = stubFetcher(() => {
      throw new Error("network must not be used");
    });
    const result = await getRate(db, second.fetcher, { from: "USD", date: "2026-10-01" });
    expect(result).toMatchObject({ status: "ok", rate: "122.4567", cached: true });
    expect(second.calls).toHaveLength(0);
  });

  it("returns 1 for the same currency with no call", async () => {
    const { fetcher, calls } = stubFetcher(frankfurter);
    const result = await getRate(db, fetcher, { from: "BDT", date: "2026-10-01" });
    expect(result).toMatchObject({
      status: "ok",
      rate: "1",
      rateScaled: 100000000,
      provider: "identity",
    });
    expect(calls).toHaveLength(0);
  });

  it("returns manual required when Frankfurter times out, and caches nothing", async () => {
    const { fetcher } = stubFetcher(
      (_url, call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () => reject(call.signal?.reason));
        }),
    );
    const result = await getRate(db, fetcher, { from: "USD", date: "2026-10-01", timeoutMs: 20 });
    expect(result).toMatchObject({ status: "manual_required", reason: "timeout" });
    expect("rate" in result).toBe(false);
    const { results } = await env.DB.prepare("SELECT count(*) AS n FROM fx_rates").all();
    expect(results).toEqual([{ n: 0 }]);
  });

  it("returns manual required for a network error or a 5xx", async () => {
    const down = stubFetcher(() => Promise.reject(new TypeError("fetch failed")));
    expect(await getRate(db, down.fetcher, { from: "USD", date: "2026-10-01" })).toMatchObject({
      status: "manual_required",
      reason: "unavailable",
    });
    const error = stubFetcher(() => new Response("oops", { status: 503 }));
    expect(await getRate(db, error.fetcher, { from: "USD", date: "2026-10-01" })).toMatchObject({
      status: "manual_required",
      reason: "unavailable",
    });
  });

  it("returns manual required for a currency the provider does not support", async () => {
    const { fetcher } = stubFetcher(() =>
      Response.json({ status: 422, message: "invalid currency: XAF" }, { status: 422 }),
    );
    expect(await getRate(db, fetcher, { from: "XAF", date: "2026-10-01" })).toMatchObject({
      status: "manual_required",
      reason: "unsupported",
    });
    const unknown = stubFetcher(frankfurter);
    expect(await getRate(db, unknown.fetcher, { from: "ZZZ", date: "2026-10-01" })).toMatchObject({
      status: "manual_required",
      reason: "unsupported",
    });
    expect(unknown.calls).toHaveLength(0);
  });

  it("returns manual required for an unexpected response body", async () => {
    const { fetcher } = stubFetcher(() => Response.json({ rates: { BDT: 122 } }));
    expect(await getRate(db, fetcher, { from: "USD", date: "2026-10-01" })).toMatchObject({
      status: "manual_required",
      reason: "invalid_response",
    });
  });

  it("falls back to the latest rate for a date after the last publication, without caching", async () => {
    const { fetcher, calls } = stubFetcher((url) =>
      url.searchParams.has("date")
        ? Response.json({ status: 404, message: "not found" }, { status: 404 })
        : frankfurter(url),
    );
    const now = Date.parse("2026-10-05T03:00:00Z");
    const result = await getRate(db, fetcher, { from: "USD", date: "2026-10-05", now });
    expect(result).toMatchObject({ status: "ok", rate: "122.5", rateDate: "2026-10-02" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.frankfurter.dev/v2/rate/USD/BDT?date=2026-10-05",
      "https://api.frankfurter.dev/v2/rate/USD/BDT",
    ]);
    const { results } = await env.DB.prepare("SELECT count(*) AS n FROM fx_rates").all();
    expect(results).toEqual([{ n: 0 }]);
  });

  it("builds a manual rate that the user typed in", () => {
    expect(manualRate("121.50", "2026-10-01")).toEqual({
      status: "ok",
      rate: "121.5",
      rateScaled: 12150000000,
      rateDate: "2026-10-01",
      provider: "manual",
      cached: false,
    });
    expect(() => manualRate("0", "2026-10-01")).toThrow();
  });
});
