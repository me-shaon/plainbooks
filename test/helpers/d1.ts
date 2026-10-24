import { env } from "cloudflare:workers";
import type { Bindings } from "../../src/worker/env";

/** One prepared statement: its SQL and the values bound to it. */
export interface RecordedQuery {
  sql: string;
  params: unknown[];
}

export interface QueryCounter {
  /** Statements prepared, including the ones sent inside a batch. */
  statements: number;
  /** Round trips: batch() calls plus statements run on their own. */
  batches: number;
  /** Every prepared statement in order, for query plan checks. */
  queries: RecordedQuery[];
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
    queries: [],
    reset() {
      counter.statements = 0;
      counter.batches = 0;
      counter.queries = [];
    },
  };
  const db = base.DB;
  const DB = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          counter.statements += 1;
          const recorded: RecordedQuery = { sql: query, params: [] };
          counter.queries.push(recorded);
          const statement = target.prepare(query);
          const bind = statement.bind.bind(statement);
          statement.bind = (...values: unknown[]) => {
            recorded.params = values;
            return bind(...values);
          };
          return statement;
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

/** The lines of `EXPLAIN QUERY PLAN` for a recorded statement, with its bound values. */
export async function queryPlan(query: RecordedQuery, d1: D1Database = env.DB): Promise<string[]> {
  const result = await d1
    .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .bind(...query.params)
    .all<{ detail: string }>();
  return result.results.map((row) => row.detail);
}
