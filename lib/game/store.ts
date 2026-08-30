/**
 * Store rules. Takes an explicit userId; see lib/game/cards.ts for why.
 */
import { CFG } from "@/lib/config";
import { fail, tx } from "@/lib/db";
import { accrue } from "@/lib/energy";
import { type Res, guard } from "./guard";


/** Burn Portfolio Value for OPT (§12). The strategic cost is leaderboard position. */
export async function convertPortfolioToOptFor(userId: number, usdAmount: number): Promise<Res> {
  return guard(async () => {
    const me = { id: userId };
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

/**
 * Which tier of capacity upgrade the player is on. Clamped at 0: players created before an
 * INITIAL_ENERGY_CAPACITY change sit below the new baseline, which would otherwise index the
 * price table negatively and charge NaN. Capacity Chips and Energy Cells share the index —
 * they grant the same step, so buying either raises the price of the next one.
 */
export const capacityTier = (capacity: number) =>
  Math.max(0, Math.round((capacity - CFG.INITIAL_ENERGY_CAPACITY) / CFG.ENERGY_CELL_STEP));

/**
 * Raises capacity by one step, optionally topping the bar up to the new ceiling.
 *
 * The accrual clock is always stamped here, and that is not incidental. Energy accrues from
 * energy_updated_at, and a player sitting at full capacity never has it rewritten (the read
 * path only persists when the value actually changes), so it drifts arbitrarily far into the
 * past. Raising the ceiling without stamping it would let every idle tick land at once: three
 * hours at full turned a +10 upgrade into +10 capacity *and* a free refill, which is exactly
 * the Energy Charge nobody would then buy. Now the refill is something you choose and pay for.
 */
async function upgradeCapacity(userId: number, refill: boolean): Promise<Res> {
  return guard(async () => {
    return await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT portfolio, locked, energy, energy_capacity, energy_updated_at
           FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      const u = rows[0];
      if (!u) fail("player not found");

      const prices = refill ? CFG.ENERGY_CELL_PRICES : CFG.ENERGY_CAPACITY_PRICES;
      const tier = capacityTier(u.energy_capacity);
      if (tier >= prices.length) fail("Maximum Energy capacity reached");

      const cost = prices[tier];
      const free = u.portfolio - u.locked;
      if (free < cost) fail(`Need $${cost} free Portfolio — you have $${free.toFixed(0)}`);

      const newCap = u.energy_capacity + CFG.ENERGY_CELL_STEP;
      const energy = refill ? newCap : accrue(u).energy;
      await c.query(
        `UPDATE users
            SET portfolio = portfolio - $2, energy_capacity = $3,
                energy = $4, energy_updated_at = now()
          WHERE id = $1`,
        [userId, cost, newCap, energy]
      );
      return {
        ok: true,
        message: refill
          ? `Capacity ${newCap} · charged to full`
          : `Energy capacity upgraded to ${newCap}`,
      };
    });
  });
}

/** Energy Cell: capacity upgrade *and* a top-up to the new ceiling (§14). */
export const buyEnergyCellFor = (userId: number) => upgradeCapacity(userId, true);

/** Capacity Chip: the ceiling only. Cheaper; the new slots fill at the usual rate. */
export const buyCapacityChipFor = (userId: number) => upgradeCapacity(userId, false);

/** Energy Charge: instant refill to current capacity (§15). */
export async function buyEnergyChargeFor(userId: number): Promise<Res> {
  return guard(async () => {
    const me = { id: userId };
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
