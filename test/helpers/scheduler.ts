import type { Bindings } from "../../src/worker/env";
import { runTick, TICK_INTERVAL_MS, type TickSummary } from "../../src/worker/services/scheduler";

export type HourSummary = Pick<
  TickSummary,
  "enqueued" | "claimed" | "done" | "retried" | "failed" | "deferred" | "errors"
> & { ticks: TickSummary[] };

/**
 * Runs the four cron ticks of one hour from `start`. In production the :00 tick runs the
 * enqueue phase and the :15, :30 and :45 ticks each run one heavy job, so tests that queue
 * a send need the whole hour. Returns the summed counts and each tick's summary.
 */
export async function runHour(env: Bindings, start: number): Promise<HourSummary> {
  const ticks: TickSummary[] = [];
  for (let i = 0; i < 4; i++) ticks.push(await runTick(env, start + i * TICK_INTERVAL_MS));
  const sum = (key: keyof Omit<HourSummary, "ticks">) =>
    ticks.reduce((total, t) => total + t[key], 0);
  return {
    enqueued: sum("enqueued"),
    claimed: sum("claimed"),
    done: sum("done"),
    retried: sum("retried"),
    failed: sum("failed"),
    deferred: sum("deferred"),
    errors: sum("errors"),
    ticks,
  };
}
