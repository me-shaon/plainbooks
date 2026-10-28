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
  /** batch() calls. */
  batches: number;
  /**
   * D1 queries toward the per-invocation limit: batch() calls plus statements run on
   * their own. Budget tests check this count.
   */
  roundTrips: number;
  /** Every prepared statement in order, for query plan checks. */
  queries: RecordedQuery[];
  reset(): void;
}

/**
 * Wraps the D1 binding and counts prepared statements, batch calls, and round trips. One
 * batch() call counts as one query toward the per-invocation limit, so tests budget
 * `roundTrips`.
 */
export function countingEnv(base: Bindings = env): { env: Bindings; counter: QueryCounter } {
  const counter: QueryCounter = {
    statements: 0,
    batches: 0,
    roundTrips: 0,
    queries: [],
    reset() {
      counter.statements = 0;
      counter.batches = 0;
      counter.roundTrips = 0;
      counter.queries = [];
    },
  };
  /** Counts a run of the statement as one round trip. A batch() never calls these. */
  const countRuns = (statement: D1PreparedStatement): D1PreparedStatement => {
    for (const method of ["run", "all", "first", "raw"] as const) {
      const original = statement[method].bind(statement) as (...args: unknown[]) => unknown;
      (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        counter.roundTrips += 1;
        return original(...args);
      };
    }
    return statement;
  };
  const db = base.DB;
  const DB = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          counter.statements += 1;
          const recorded: RecordedQuery = { sql: query, params: [] };
          counter.queries.push(recorded);
          const statement = countRuns(target.prepare(query));
          const bind = statement.bind.bind(statement);
          statement.bind = (...values: unknown[]) => {
            recorded.params = values;
            return countRuns(bind(...values));
          };
          return statement;
        };
      }
      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) => {
          counter.batches += 1;
          counter.roundTrips += 1;
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
