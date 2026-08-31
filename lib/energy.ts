import type { PoolClient } from "pg";
import { CFG } from "./config";
import { fail } from "./db";
import { energyCapacity, energyPerTick, levelFor, optPerDrip } from "./levels";

/**
 * The columns any accrual needs. Capacity is derived rather than stored, so xp and the upgrade
 * counts come along: a level raises the ceiling, and the bar has to know where the ceiling is.
 */
export type AccrualState = {
  xp: number;
  energy: number;
  energy_upgrades: number;
  energy_updated_at: string | Date;
  opt: number;
  opt_updated_at: string | Date;
  drip_upgrades: number;
  last_active_at: string | Date;
};

/** Every column accrue() reads. One place, so a caller can't half-select and silently stall. */
export const ACCRUAL_COLUMNS =
  "xp, energy, energy_upgrades, energy_updated_at, opt, opt_updated_at, drip_upgrades, last_active_at";

/** The OPT drip runs on its own, slower clock. */
export const dripIntervalMs = () => CFG.ENERGY_REFILL_SECONDS * 2000;

export type Accrued = {
  energy: number;
  energyUpdatedAt: Date;
  energyNextInMs: number;
  capacity: number;
  opt: number;
  optUpdatedAt: Date;
  optNextInMs: number;
  /** OPT the drip just added. Zero when idle or when no full interval has passed. */
  dripped: number;
  /** False once the player has stopped playing for OPT_DRIP_IDLE_DAYS. */
  dripActive: boolean;
};

/**
 * Advances both resources to `now`.
 *
 * Deliberately one function on one read: the two resources tick at different rates, but they
 * are needed at exactly the same moments, and splitting them would mean two lazy passes and
 * two row locks on every poll. Only whole ticks are consumed from each timestamp, so partial
 * progress toward the next one is never lost.
 */
export function accrue(u: AccrualState, now = Date.now()): Accrued {
  const level = levelFor(Number(u.xp));
  const capacity = energyCapacity(level, Number(u.energy_upgrades));

  // ---- Energy
  const eStep = CFG.ENERGY_REFILL_SECONDS * 1000;
  const eLast = new Date(u.energy_updated_at).getTime();
  const energyNow = Number(u.energy);
  let energy: number;
  let energyUpdatedAt: Date;
  let energyNextInMs: number;

  if (energyNow >= capacity) {
    // Already full: hold the clock at now, so the next tick starts from a whole interval and
    // time spent at the ceiling can't be banked and cashed in when the ceiling later rises.
    energy = capacity;
    energyUpdatedAt = new Date(now);
    energyNextInMs = 0;
  } else {
    const ticks = Math.max(0, Math.floor((now - eLast) / eStep));
    energy = Math.min(capacity, energyNow + ticks * energyPerTick(level));
    energyUpdatedAt = new Date(eLast + ticks * eStep);
    energyNextInMs = energy >= capacity ? 0 : eStep - ((now - energyUpdatedAt.getTime()) % eStep);
  }

  // ---- OPT
  // Gated on having played recently rather than capped. An uncapped drip would pay an idle
  // account more than a played one; a cap would punish the players it exists to help. The
  // signal is the last action that changed game state — not a login, which outlives interest,
  // and not a poll, which an abandoned tab would keep alive forever.
  const idleMs = now - new Date(u.last_active_at).getTime();
  const dripActive = idleMs <= CFG.OPT_DRIP_IDLE_DAYS * 86_400_000;

  const oStep = dripIntervalMs();
  const oLast = new Date(u.opt_updated_at).getTime();
  const oTicks = Math.max(0, Math.floor((now - oLast) / oStep));
  const perDrip = optPerDrip(level, Number(u.drip_upgrades));
  const dripped = dripActive ? oTicks * perDrip : 0;
  // The clock advances either way. An idle player forfeits those intervals rather than
  // collecting them all at once the moment they come back.
  const optUpdatedAt = new Date(oTicks ? oLast + oTicks * oStep : oLast);

  return {
    energy,
    energyUpdatedAt,
    energyNextInMs,
    capacity,
    opt: Number(u.opt) + dripped,
    optUpdatedAt,
    optNextInMs: oStep - ((now - optUpdatedAt.getTime()) % oStep),
    dripped,
    dripActive,
  };
}

/** Writes back whatever accrue() moved. Safe to call when nothing changed. */
export async function persistAccrual(c: PoolClient, userId: number, a: Accrued) {
  await c.query(
    `UPDATE users SET energy = $2, energy_updated_at = $3, opt = opt + $4, opt_updated_at = $5
      WHERE id = $1`,
    [userId, a.energy, a.energyUpdatedAt, a.dripped, a.optUpdatedAt]
  );
}

/** Applies accrual then deducts Energy. Throws a player-facing error if short. */
export async function spendEnergy(c: PoolClient, userId: number, cost: number) {
  const { rows } = await c.query(
    `SELECT ${ACCRUAL_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  if (!rows[0]) fail("user not found");
  const a = accrue(rows[0]);
  if (a.energy < cost) fail(`Not enough Energy (need ${cost}, have ${Math.floor(a.energy)})`);

  await c.query(
    `UPDATE users
        SET energy = $2, energy_updated_at = $3, opt = opt + $4, opt_updated_at = $5
      WHERE id = $1`,
    [userId, a.energy - cost, a.energyUpdatedAt, a.dripped, a.optUpdatedAt]
  );
}

/**
 * Stamps the player as having played. Called by every action that changes game state, which is
 * what keeps the drip flowing — polling deliberately does not count.
 */
export async function touchActivity(c: PoolClient, userId: number) {
  await c.query(`UPDATE users SET last_active_at = now() WHERE id = $1`, [userId]);
}
