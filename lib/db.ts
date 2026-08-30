import { Pool, type PoolClient } from "pg";

// numeric/int8 come back as strings by default; the game math wants numbers.
import pg from "pg";
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8

declare global {
  // eslint-disable-next-line no-var
  var __optPool: Pool | undefined;
}

export const pool =
  global.__optPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

if (process.env.NODE_ENV !== "production") global.__optPool = pool;

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

/** Runs fn inside a transaction, rolling back on any throw. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Thrown by actions for expected rule violations; surfaced to the player verbatim. */
export class GameError extends Error {}

export function fail(msg: string): never {
  throw new GameError(msg);
}
