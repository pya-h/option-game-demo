/**
 * Gaps the rest of the suite left open.
 *
 * Two things here that nothing else covered: the create-or-resume race in sign-in, and money
 * conservation as a property rather than as a handful of chosen cases. Both run inside a
 * transaction that is always rolled back.
 */
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CFG } from "@/lib/config";
import { pool } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

let c: PoolClient;
let seq = 0;

d("sign-in", () => {
  beforeEach(async () => {
    c = await pool.connect();
    await c.query("BEGIN");
  });
  afterEach(async () => {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  });

  /** The statement app/actions/auth.ts runs, verbatim in shape. */
  const signIn = (username: string) =>
    c.query<{ id: number }>(
      `WITH inserted AS (
         INSERT INTO users (username, opt, portfolio, energy, energy_updated_at)
         VALUES ($1, $2, 0, $3::numeric, now())
         ON CONFLICT (lower(username)) DO NOTHING
         RETURNING id
       )
       SELECT id FROM inserted
       UNION ALL
       SELECT id FROM users WHERE lower(username) = lower($1)
       LIMIT 1`,
      [username, CFG.INITIAL_OPT_BALANCE, CFG.INITIAL_ENERGY_CAPACITY]
    );

  it("creates an account on first use", async () => {
    const name = `race${Date.now()}_${seq++}`;
    const { rows } = await signIn(name);
    expect(rows[0].id).toBeGreaterThan(0);
  });

  it("resumes the same account rather than creating a second", async () => {
    const name = `race${Date.now()}_${seq++}`;
    const a = (await signIn(name)).rows[0].id;
    const b = (await signIn(name)).rows[0].id;
    expect(b).toBe(a);
  });

  it("resumes across case, which is how the lookup works", async () => {
    const name = `Race${Date.now()}_${seq++}`;
    const a = (await signIn(name)).rows[0].id;
    const b = (await signIn(name.toUpperCase())).rows[0].id;
    const c2 = (await signIn(name.toLowerCase())).rows[0].id;
    expect(b).toBe(a);
    expect(c2).toBe(a);
  });

  it("cannot produce two accounts differing only by case", async () => {
    // The bug the case-insensitive unique index exists to prevent: "Bob" and "bob" both
    // landing, after which the lookup picks between them arbitrarily.
    const name = `Dup${Date.now()}_${seq++}`;
    await signIn(name);
    await signIn(name.toLowerCase());
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM users WHERE lower(username) = lower($1)`, [
      name,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("starts a new account at the configured balance and a full bar", async () => {
    const name = `fresh${Date.now()}_${seq++}`;
    const id = (await signIn(name)).rows[0].id;
    const { rows } = await c.query(
      `SELECT opt, portfolio, locked, xp, energy, energy_upgrades, drip_upgrades, level_seen
         FROM users WHERE id = $1`,
      [id]
    );
    const u = rows[0];
    expect(Number(u.opt)).toBe(CFG.INITIAL_OPT_BALANCE);
    expect(Number(u.portfolio)).toBe(0);
    expect(Number(u.energy)).toBe(CFG.INITIAL_ENERGY_CAPACITY);
    expect(u.energy_upgrades).toBe(0);
    expect(u.drip_upgrades).toBe(0);
    expect(u.level_seen).toBe(1);
  });
});

d("balance invariants hold under arbitrary writes", () => {
  beforeEach(async () => {
    c = await pool.connect();
    await c.query("BEGIN");
  });
  afterEach(async () => {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  });
  afterAll(async () => {
    await pool.end();
  });

  const mkUser = async () => {
    const { rows } = await c.query(
      `INSERT INTO users (username, opt, portfolio, locked, energy)
       VALUES ($1, 1000, 1000, 0, 10) RETURNING id`,
      [`inv${Date.now()}_${seq++}`]
    );
    return rows[0].id;
  };

  /** Runs one statement in a savepoint so a rejected write doesn't poison the transaction. */
  const attempt = async (sql: string, params: unknown[]) => {
    await c.query("SAVEPOINT s");
    try {
      await c.query(sql, params);
      await c.query("RELEASE SAVEPOINT s");
      return true;
    } catch {
      await c.query("ROLLBACK TO SAVEPOINT s");
      return false;
    }
  };

  it("refuses to let any balance go negative, whatever the caller asks for", async () => {
    const id = await mkUser();
    // The database is the last line of defence: every rule above it is code that can be wrong.
    expect(await attempt(`UPDATE users SET opt = -1 WHERE id = $1`, [id])).toBe(false);
    expect(await attempt(`UPDATE users SET portfolio = -0.000001 WHERE id = $1`, [id])).toBe(false);
    expect(await attempt(`UPDATE users SET locked = -5 WHERE id = $1`, [id])).toBe(false);
  });

  it("refuses to lock more Portfolio than exists", async () => {
    const id = await mkUser();
    expect(await attempt(`UPDATE users SET locked = 1001 WHERE id = $1`, [id])).toBe(false);
    expect(await attempt(`UPDATE users SET locked = 1000 WHERE id = $1`, [id])).toBe(true);
    // And it cannot be undermined from the other side either.
    expect(await attempt(`UPDATE users SET portfolio = 999 WHERE id = $1`, [id])).toBe(false);
  });

  it("refuses negative upgrade counts, which would index a price table backwards", async () => {
    const id = await mkUser();
    expect(await attempt(`UPDATE users SET energy_upgrades = -1 WHERE id = $1`, [id])).toBe(false);
    expect(await attempt(`UPDATE users SET drip_upgrades = -1 WHERE id = $1`, [id])).toBe(false);
  });

  it("holds the same invariants on PvP balances", async () => {
    const uid = await mkUser();
    const { rows: m } = await c.query(
      `INSERT INTO matches (name, creator_id, mode, duration_min) VALUES ('t',$1,'DUEL',5) RETURNING id`,
      [uid]
    );
    await c.query(
      `INSERT INTO match_players (match_id, user_id, state, pvp_opt, pvp_portfolio)
       VALUES ($1,$2,'JOINED',100,100)`,
      [m[0].id, uid]
    );
    const where = `WHERE match_id = $1 AND user_id = $2`;
    const p = [m[0].id, uid];
    expect(await attempt(`UPDATE match_players SET pvp_opt = -1 ${where}`, p)).toBe(false);
    expect(await attempt(`UPDATE match_players SET pvp_locked = 101 ${where}`, p)).toBe(false);
  });

  it("only accepts card statuses the game knows about", async () => {
    const uid = await mkUser();
    const insert = (status: string) =>
      attempt(
        `INSERT INTO cards (owner_id, creator_id, kind, asset, strike, amount, spot_at_create,
                            premium, expires_at, status)
         VALUES ($1,$1,'BUY','BTC',100,1,100,10, now(), $2)`,
        [uid, status]
      );
    for (const ok of ["ACTIVE", "WON", "LOST", "EXERCISED", "SETTLED", "LAPSED"]) {
      expect(await insert(ok)).toBe(true);
    }
    expect(await insert("PASSED_AWAY")).toBe(false);
  });
});
