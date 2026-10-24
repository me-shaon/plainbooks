import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

/**
 * Returns a typed Drizzle handle over the D1 binding. It is cheap to create, so call it
 * per request (`createDb(c.env.DB)`) or per test (`createDb(env.DB)`).
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

const requestScoped = new WeakSet<Db>();

/**
 * `createDb` for a handle that lives for one request or one cron tick. Services may cache
 * reads on such a handle (see `loadWorkspace`), because every statement counts toward the
 * D1 per-invocation query limit. Never cache on a shared handle.
 */
export function createRequestDb(d1: D1Database): Db {
  const db = createDb(d1);
  requestScoped.add(db);
  return db;
}

/** True for a handle from `createRequestDb`. */
export function isRequestScoped(db: Db): boolean {
  return requestScoped.has(db);
}

export { schema };
