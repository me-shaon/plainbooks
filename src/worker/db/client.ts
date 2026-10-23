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

export { schema };
