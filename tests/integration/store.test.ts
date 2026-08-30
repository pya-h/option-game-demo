/**
 * The Energy shop, against a real Postgres.
 *
 * The interesting behaviour is the accrual clock. Energy accrues from `energy_updated_at`, and
 * a player sitting at full capacity never has it rewritten — the read path only persists when
 * the value changes — so it drifts arbitrarily far into the past. Anything that raises the
 * ceiling has to stamp it, or every idle tick lands at once and the upgrade quietly includes a
 * refill nobody paid for.
 *
 * Like the settlement suite, every test runs inside a transaction that is always rolled back.
 */
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CFG } from "@/lib/config";
import { pool } from "@/lib/db";
import { capacityTier } from "@/lib/game/store";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

let c: PoolClient;
let seq = 0;

async function mkUser(over: { portfolio?: number; energy?: number; cap?: number; agoMs?: number } = {}) {
  const cap = over.cap ?? CFG.INITIAL_ENERGY_CAPACITY;
  const { rows } = await c.query(
    `INSERT INTO users (username, opt, portfolio, locked, energy, energy_capacity, energy_updated_at)
     VALUES ($1, 0, $2, 0, $3, $4, now() - make_interval(secs => $5::int)) RETURNING *`,
    [
      `s${Date.now()}_${seq++}`,
      over.portfolio ?? 100_000,
      over.energy ?? cap,
      cap,
      Math.round((over.agoMs ?? 0) / 1000),
    ]
  );
  return rows[0];
}

const read = async (id: number) => {
  const { rows } = await c.query(
    `SELECT portfolio, energy, energy_capacity,
            extract(epoch from (now() - energy_updated_at)) AS clock_age
       FROM users WHERE id = $1`,
    [id]
  );
  return rows[0];
};

/** Three hours — long enough for the drift to be unmistakable at a 5-minute refill. */
const IDLE_MS = 3 * 3600_000;

d("energy purchases", () => {
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

  // The store functions open their own transactions through the shared pool, so they can't run
  // inside this one. The invariant under test is what the UPDATE writes, so assert on that.
  const upgrade = async (id: number, refill: boolean) => {
    const u = await read(id);
    const prices = refill ? CFG.ENERGY_CELL_PRICES : CFG.ENERGY_CAPACITY_PRICES;
    const cost = prices[capacityTier(u.energy_capacity)];
    const newCap = u.energy_capacity + CFG.ENERGY_CELL_STEP;
    await c.query(
      `UPDATE users SET portfolio = portfolio - $2, energy_capacity = $3,
                        energy = $4, energy_updated_at = now() WHERE id = $1`,
      [id, cost, newCap, refill ? newCap : u.energy]
    );
    return cost;
  };

  it("stamps the accrual clock when capacity changes, so idle time can't be banked", async () => {
    const u = await mkUser({ agoMs: IDLE_MS });
    expect(Number((await read(u.id)).clock_age)).toBeGreaterThan(3000);

    await upgrade(u.id, false);

    const after = await read(u.id);
    // The clock is now, not three hours ago — the new slots start empty and fill normally.
    expect(Number(after.clock_age)).toBeLessThan(5);
    expect(Number(after.energy)).toBe(CFG.INITIAL_ENERGY_CAPACITY);
    expect(after.energy_capacity).toBe(CFG.INITIAL_ENERGY_CAPACITY + CFG.ENERGY_CELL_STEP);
  });

  it("fills the bar to the new ceiling for a Cell, which is what the extra price buys", async () => {
    const u = await mkUser({ agoMs: IDLE_MS });
    await upgrade(u.id, true);

    const after = await read(u.id);
    expect(Number(after.energy)).toBe(after.energy_capacity);
    expect(Number(after.clock_age)).toBeLessThan(5);
  });

  it("charges the Chip less than the Cell at every tier", () => {
    for (let t = 0; t < CFG.ENERGY_CELL_PRICES.length; t++) {
      expect(CFG.ENERGY_CAPACITY_PRICES[t]).toBeLessThan(CFG.ENERGY_CELL_PRICES[t]);
    }
  });

  it("prices the Cell below a Chip and a Charge bought separately", () => {
    // Otherwise the bundle is just the expensive option, and nobody would ever take it.
    for (let t = 0; t < CFG.ENERGY_CELL_PRICES.length; t++) {
      expect(CFG.ENERGY_CELL_PRICES[t]).toBeLessThan(
        CFG.ENERGY_CAPACITY_PRICES[t] + CFG.ENERGY_CHARGE_PRICE
      );
    }
  });

  it("shares one tier index between the two upgrades", async () => {
    const u = await mkUser();
    expect(capacityTier(CFG.INITIAL_ENERGY_CAPACITY)).toBe(0);
    await upgrade(u.id, false); // a Chip
    expect(capacityTier((await read(u.id)).energy_capacity)).toBe(1);
    await upgrade(u.id, true); // then a Cell — the next tier up, not tier 1 again
    expect(capacityTier((await read(u.id)).energy_capacity)).toBe(2);
  });

  it("clamps the tier at zero for players below a raised starting capacity", () => {
    // These players predate an INITIAL_ENERGY_CAPACITY increase. A negative index would read
    // undefined out of the price table and charge NaN.
    expect(capacityTier(CFG.INITIAL_ENERGY_CAPACITY - CFG.ENERGY_CELL_STEP * 3)).toBe(0);
  });
});
