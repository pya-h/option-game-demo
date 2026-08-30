"use server";

import { CFG } from "@/lib/config";
import { GameError, fail, tx } from "@/lib/db";
import { accrue } from "@/lib/energy";

type Res = { ok: boolean; message?: string };

async function guard(fn: () => Promise<Res>): Promise<Res> {
  try {
    return await fn();
  } catch (e: any) {
    if (e instanceof GameError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Server error" };
  }
}

import { requireMe } from "@/lib/session";

/** Burn Portfolio Value for OPT (§12). The strategic cost is leaderboard position. */
export async function convertPortfolioToOpt(usdAmount: number): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    if (!(usdAmount > 0) || !Number.isFinite(usdAmount)) fail("invalid amount");

    return await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT portfolio, locked FROM users WHERE id = $1 FOR UPDATE`,
        [me.id]
      );
      const free = rows[0].portfolio - rows[0].locked;
      if (free < usdAmount)
        fail(`Only $${free.toFixed(0)} of your Portfolio is free (the rest is locked as collateral)`);

      const gained = usdAmount * CFG.PORTFOLIO_TO_OPT_RATIO;
      await c.query(`UPDATE users SET portfolio = portfolio - $2, opt = opt + $3 WHERE id = $1`, [
        me.id,
        usdAmount,
        gained,
      ]);
      return { ok: true, message: `Burned $${usdAmount.toFixed(0)} → +${gained.toFixed(0)} OPT` };
    });
  });
}

/** Energy Cell: permanent capacity upgrade (§14). Price escalates per tier. */
export async function buyEnergyCell(): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    return await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT portfolio, locked, energy, energy_capacity, energy_updated_at
           FROM users WHERE id = $1 FOR UPDATE`,
        [me.id]
      );
      const u = rows[0];
      // Clamped at 0: players created before an INITIAL_ENERGY_CAPACITY change sit below the
      // new baseline, which would otherwise index the price table negatively and charge NaN.
      const tier = Math.max(
        0,
        Math.round((u.energy_capacity - CFG.INITIAL_ENERGY_CAPACITY) / CFG.ENERGY_CELL_STEP)
      );
      if (tier >= CFG.ENERGY_CELL_PRICES.length) fail("Maximum Energy capacity reached");

      const cost = CFG.ENERGY_CELL_PRICES[tier];
      const free = u.portfolio - u.locked;
      if (free < cost) fail(`Need $${cost} free Portfolio — you have $${free.toFixed(0)}`);

      const newCap = u.energy_capacity + CFG.ENERGY_CELL_STEP;
      await c.query(
        `UPDATE users SET portfolio = portfolio - $2, energy_capacity = $3 WHERE id = $1`,
        [me.id, cost, newCap]
      );
      return { ok: true, message: `Energy capacity upgraded to ${newCap}` };
    });
  });
}

/** Energy Charge: instant refill to current capacity (§15). */
export async function buyEnergyCharge(): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    return await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT portfolio, locked, energy, energy_capacity, energy_updated_at
           FROM users WHERE id = $1 FOR UPDATE`,
        [me.id]
      );
      const u = rows[0];
      const cur = accrue(u).energy;
      if (cur >= u.energy_capacity) fail("Your Energy is already full");

      const free = u.portfolio - u.locked;
      const cost = CFG.ENERGY_CHARGE_PRICE;
      if (free < cost) fail(`Need $${cost} free Portfolio — you have $${free.toFixed(0)}`);

      await c.query(
        `UPDATE users SET portfolio = portfolio - $2, energy = $3, energy_updated_at = now() WHERE id = $1`,
        [me.id, cost, u.energy_capacity]
      );
      return { ok: true, message: `Energy refilled to ${u.energy_capacity}` };
    });
  });
}
