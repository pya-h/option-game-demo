import type { PoolClient } from "pg";
import { CFG } from "./config";
import { fail } from "./db";

export type EnergyState = {
  energy: number;
  energy_capacity: number;
  energy_updated_at: string | Date;
};

/**
 * Energy accrues lazily: +1 every ENERGY_REFILL_SECONDS, capped at capacity.
 * Only whole ticks are consumed from energy_updated_at so partial progress is never lost.
 */
export function accrue(u: EnergyState, now = Date.now()) {
  const last = new Date(u.energy_updated_at).getTime();
  const step = CFG.ENERGY_REFILL_SECONDS * 1000;
  const ticks = Math.floor((now - last) / step);

  if (u.energy >= u.energy_capacity) {
    // Already full: keep the clock at now so the next tick starts from a full interval.
    return { energy: u.energy_capacity, updatedAt: new Date(now), nextInMs: 0 };
  }
  const energy = Math.min(u.energy_capacity, u.energy + Math.max(0, ticks));
  const updatedAt = new Date(last + Math.max(0, ticks) * step);
  const nextInMs =
    energy >= u.energy_capacity ? 0 : step - ((now - updatedAt.getTime()) % step);

  return { energy, updatedAt, nextInMs };
}

/** Applies accrual then deducts cost. Throws a player-facing error if short. */
export async function spendEnergy(c: PoolClient, userId: number, cost: number) {
  const { rows } = await c.query(
    `SELECT energy, energy_capacity, energy_updated_at FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  if (!rows[0]) fail("user not found");
  const a = accrue(rows[0]);
  if (a.energy < cost) fail(`Not enough Energy (need ${cost}, have ${Math.floor(a.energy)})`);

  await c.query(`UPDATE users SET energy = $2, energy_updated_at = $3 WHERE id = $1`, [
    userId,
    a.energy - cost,
    a.updatedAt,
  ]);
}

/** Persists accrued energy on read so the displayed value and the DB agree. */
export async function syncEnergy(c: PoolClient, userId: number) {
  const { rows } = await c.query(
    `SELECT energy, energy_capacity, energy_updated_at FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) return;
  const a = accrue(rows[0]);
  if (a.energy !== rows[0].energy) {
    await c.query(`UPDATE users SET energy = $2, energy_updated_at = $3 WHERE id = $1`, [
      userId,
      a.energy,
      a.updatedAt,
    ]);
  }
}
