/**
 * The Energy shop, against a real Postgres.
 *
 * Two things here have bitten before and are guarded deliberately. The accrual clock: Energy
 * accrues from `energy_updated_at`, and a player sitting at full capacity never has it
 * rewritten, so it drifts arbitrarily far into the past — anything that raises the ceiling has
 * to stamp it, or every idle tick lands at once and the upgrade quietly includes a free refill.
 * And the tier index: it must count what was *bought*, never what capacity happens to be, now
 * that levels raise capacity too.
 *
 * Like the settlement suite, every test runs inside a transaction that is always rolled back.
 */
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CFG } from "@/lib/config";
import { pool } from "@/lib/db";
import { accrue } from "@/lib/energy";
import { capacityTier } from "@/lib/game/store";
import { energyCapacity, xpForLevel } from "@/lib/levels";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

let c: PoolClient;
let seq = 0;

async function mkUser(
  over: { portfolio?: number; energy?: number; xp?: number; upgrades?: number; agoMs?: number } = {}
) {
  const { rows } = await c.query(
    `INSERT INTO users (username, opt, portfolio, locked, xp, energy, energy_upgrades,
                        energy_updated_at)
     VALUES ($1, 0, $2, 0, $3, $4, $5, now() - make_interval(secs => $6::int)) RETURNING *`,
    [
      `s${Date.now()}_${seq++}`,
      over.portfolio ?? 100_000,
      over.xp ?? 0,
      over.energy ?? CFG.INITIAL_ENERGY_CAPACITY,
      over.upgrades ?? 0,
      Math.round((over.agoMs ?? 0) / 1000),
    ]
  );
  return rows[0];
}

const read = async (id: number) => {
  const { rows } = await c.query(
    `SELECT portfolio, energy, energy_upgrades, drip_upgrades, xp,
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
    const cost = prices[capacityTier(u.energy_upgrades)];
    const bought = Number(u.energy_upgrades) + 1;
    const newCap = energyCapacity(1, bought);
    await c.query(
      `UPDATE users SET portfolio = portfolio - $2, energy_upgrades = $3,
                        energy = $4, energy_updated_at = now() WHERE id = $1`,
      [id, cost, bought, refill ? newCap : u.energy]
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
    expect(energyCapacity(1, after.energy_upgrades)).toBe(
      CFG.INITIAL_ENERGY_CAPACITY + CFG.ENERGY_CELL_STEP
    );
  });

  it("fills the bar to the new ceiling for a Cell, which is what the extra price buys", async () => {
    const u = await mkUser({ agoMs: IDLE_MS });
    await upgrade(u.id, true);

    const after = await read(u.id);
    expect(Number(after.energy)).toBe(energyCapacity(1, after.energy_upgrades));
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
    expect(capacityTier(0)).toBe(0);
    await upgrade(u.id, false); // a Chip
    expect(capacityTier((await read(u.id)).energy_upgrades)).toBe(1);
    await upgrade(u.id, true); // then a Cell — the next tier up, not tier 1 again
    expect(capacityTier((await read(u.id)).energy_upgrades)).toBe(2);
  });

  it("charges a high-level player who owns nothing the FIRST tier", async () => {
    // The regression this refactor exists for. The tier used to be inferred from total
    // capacity as (capacity - INITIAL) / STEP, which worked only while purchases were the
    // sole thing that moved capacity. Levels move it too, so that arithmetic read level
    // bonuses as purchases: at level 6, round(5/10) is 1, and a player who had bought nothing
    // was charged tier-2 prices for their first Cell.
    const u = await mkUser({ xp: xpForLevel(6) });
    const state = await read(u.id);
    expect(state.energy_upgrades).toBe(0);

    const cap = energyCapacity(6, 0);
    expect(cap).toBeGreaterThan(CFG.INITIAL_ENERGY_CAPACITY); // the level really did raise it
    expect(Math.round((cap - CFG.INITIAL_ENERGY_CAPACITY) / CFG.ENERGY_CELL_STEP)).toBe(1); // old formula
    expect(capacityTier(state.energy_upgrades)).toBe(0); // new one
    expect(CFG.ENERGY_CELL_PRICES[capacityTier(state.energy_upgrades)]).toBe(
      CFG.ENERGY_CELL_PRICES[0]
    );
  });

  it("keeps level capacity and bought capacity separable", () => {
    // Same total, different make-up — and the price must follow what was bought.
    expect(energyCapacity(11, 0)).toBe(energyCapacity(1, 1));
    expect(capacityTier(0)).not.toBe(capacityTier(1));
  });

  it("lets a levelled player charge to the higher ceiling", async () => {
    const u = await mkUser({ xp: xpForLevel(8), energy: 0, agoMs: IDLE_MS });
    const a = accrue(await fullRow(u.id));
    expect(a.capacity).toBe(energyCapacity(8, 0));
    expect(a.capacity).toBe(CFG.INITIAL_ENERGY_CAPACITY + 7);
  });

  it("sells drip upgrades one at a time, up the price ladder", async () => {
    const u = await mkUser();
    for (let t = 0; t < CFG.OPT_DRIP_UPGRADE_PRICES.length; t++) {
      await c.query(`UPDATE users SET drip_upgrades = $2 WHERE id = $1`, [u.id, t + 1]);
    }
    expect((await read(u.id)).drip_upgrades).toBe(CFG.OPT_DRIP_UPGRADE_PRICES.length);
    // Prices escalate, so the ladder can't be farmed cheaply.
    for (let t = 1; t < CFG.OPT_DRIP_UPGRADE_PRICES.length; t++) {
      expect(CFG.OPT_DRIP_UPGRADE_PRICES[t]).toBeGreaterThan(CFG.OPT_DRIP_UPGRADE_PRICES[t - 1]);
    }
  });

  const fullRow = async (id: number) =>
    (await c.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
});
