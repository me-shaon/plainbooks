import { env } from "cloudflare:workers";
import type { Bindings } from "../../src/worker/env";

export interface QueryCounter {
  /** Statements prepared, including the ones sent inside a batch. */
  statements: number;
  /** Round trips: batch() calls plus statements run on their own. */
  batches: number;
  reset(): void;
}

/**
 * Wraps the D1 binding and counts prepared statements and batch calls. Every statement
 * counts toward the per-invocation query limit, so tests budget `statements`.
 */
export function countingEnv(base: Bindings = env): { env: Bindings; counter: QueryCounter } {
  const counter: QueryCounter = {
    statements: 0,
    batches: 0,
    reset() {
      counter.statements = 0;
      counter.batches = 0;
    },
  };
  const db = base.DB;
  const DB = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          counter.statements += 1;
          return target.prepare(query);
        };
      }
      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) => {
          counter.batches += 1;
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { env: { ...base, DB }, counter };
}
