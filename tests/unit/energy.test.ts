import { describe, expect, it } from "vitest";
import { CFG } from "@/lib/config";
import { type AccrualState, accrue, dripIntervalMs } from "@/lib/energy";
import { energyCapacity, optPerDrip, xpForLevel } from "@/lib/levels";

const STEP = CFG.ENERGY_REFILL_SECONDS * 1000;
const DRIP = dripIntervalMs();
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const CAP0 = CFG.INITIAL_ENERGY_CAPACITY;

/**
 * A player row as accrue() reads it. Capacity is derived now, so the knobs are xp (which sets
 * the level) and how many upgrades were bought — not a capacity column.
 */
const at = (
  energy: number,
  msAgo: number,
  over: Partial<AccrualState> & { upgrades?: number; xp?: number } = {}
): AccrualState => ({
  xp: over.xp ?? 0,
  energy,
  energy_upgrades: over.upgrades ?? 0,
  energy_updated_at: new Date(T0 - msAgo).toISOString(),
  opt: over.opt ?? 0,
  // Far enough back that OPT never accrues unless a test asks for it.
  opt_updated_at: over.opt_updated_at ?? new Date(T0).toISOString(),
  drip_upgrades: over.drip_upgrades ?? 0,
  last_active_at: over.last_active_at ?? new Date(T0).toISOString(),
});

describe("energy accrual", () => {
  it("grants one point per refill interval", () => {
    expect(accrue(at(10, STEP * 3), T0).energy).toBe(13);
  });

  it("grants nothing before a full interval has passed", () => {
    expect(accrue(at(10, STEP - 1), T0).energy).toBe(10);
  });

  it("keeps partial progress toward the next point", () => {
    // Two and a half intervals: two points land, and the half-interval is not thrown away.
    const a = accrue(at(10, STEP * 2.5), T0);
    expect(a.energy).toBe(12);
    expect(a.energyUpdatedAt.getTime()).toBe(T0 - STEP * 0.5);
  });

  it("clamps at capacity no matter how long the player was away", () => {
    expect(accrue(at(0, STEP * 10_000), T0).energy).toBe(CAP0);
  });

  it("reports no next tick once the bar is full", () => {
    expect(accrue(at(CAP0, STEP * 3), T0).energyNextInMs).toBe(0);
  });

  it("restarts the clock from now when already full, so spending starts a fresh interval", () => {
    const a = accrue(at(CAP0, STEP * 99), T0);
    expect(a.energy).toBe(CAP0);
    expect(a.energyUpdatedAt.getTime()).toBe(T0);
  });

  it("counts down to the next point when partway through an interval", () => {
    const a = accrue(at(1, STEP * 0.25), T0);
    expect(a.energy).toBe(1);
    expect(a.energyNextInMs).toBeGreaterThan(0);
    expect(a.energyNextInMs).toBeLessThanOrEqual(STEP);
    expect(a.energyNextInMs).toBeCloseTo(STEP * 0.75, -1);
  });

  it("never moves backwards if the stored clock is in the future", () => {
    expect(accrue(at(5, -STEP * 3), T0).energy).toBe(5);
  });

  it("honours a raised capacity from an Energy Cell", () => {
    const a = accrue(at(CAP0, STEP * 50, { upgrades: 1 }), T0);
    expect(a.capacity).toBe(CAP0 + CFG.ENERGY_CELL_STEP);
    expect(a.energy).toBe(a.capacity);
  });

  it("raises capacity by one per level, on top of anything bought", () => {
    const a = accrue(at(0, 0, { xp: xpForLevel(6), upgrades: 2 }), T0);
    expect(a.capacity).toBe(energyCapacity(6, 2));
    expect(a.capacity).toBe(CAP0 + 2 * CFG.ENERGY_CELL_STEP + 5);
  });

  it("grants more per tick at milestone levels", () => {
    // Level 5 is the first milestone, so a tick is worth 2 rather than 1.
    const low = accrue(at(0, STEP * 3, { xp: 0 }), T0);
    const high = accrue(at(0, STEP * 3, { xp: xpForLevel(5) }), T0);
    expect(low.energy).toBe(3);
    expect(high.energy).toBe(6);
  });
});

describe("the OPT drip", () => {
  const dripAt = (msAgo: number, over: Partial<AccrualState> = {}) =>
    at(0, 0, { ...over, opt_updated_at: new Date(T0 - msAgo).toISOString() });

  it("pays once per drip interval, which is slower than the Energy one", () => {
    expect(DRIP).toBe(STEP * 2);
    expect(accrue(dripAt(DRIP * 3), T0).dripped).toBe(CFG.OPT_DRIP_AMOUNT * 3);
  });

  it("pays nothing before a full interval", () => {
    expect(accrue(dripAt(DRIP - 1), T0).dripped).toBe(0);
  });

  it("keeps partial progress toward the next drop", () => {
    const a = accrue(dripAt(DRIP * 2.5), T0);
    expect(a.dripped).toBe(CFG.OPT_DRIP_AMOUNT * 2);
    expect(a.optUpdatedAt.getTime()).toBe(T0 - DRIP * 0.5);
  });

  it("adds what it paid to the balance it reports", () => {
    const a = accrue({ ...dripAt(DRIP), opt: 1000 }, T0);
    expect(a.opt).toBe(1000 + CFG.OPT_DRIP_AMOUNT);
  });

  it("stops for a player who has not played in a week", () => {
    const idle = new Date(T0 - (CFG.OPT_DRIP_IDLE_DAYS + 1) * 86_400_000).toISOString();
    const a = accrue(dripAt(DRIP * 100, { last_active_at: idle }), T0);
    expect(a.dripActive).toBe(false);
    expect(a.dripped).toBe(0);
  });

  it("does not let an idle player bank the intervals they missed", () => {
    // The clock advances whether or not it paid, so coming back does not cash in a fortune.
    const idle = new Date(T0 - (CFG.OPT_DRIP_IDLE_DAYS + 1) * 86_400_000).toISOString();
    const a = accrue(dripAt(DRIP * 500, { last_active_at: idle }), T0);
    expect(a.optUpdatedAt.getTime()).toBeGreaterThanOrEqual(T0 - DRIP);
  });

  it("keeps paying right up to the idle cutoff", () => {
    const nearly = new Date(T0 - (CFG.OPT_DRIP_IDLE_DAYS * 86_400_000 - 60_000)).toISOString();
    const a = accrue(dripAt(DRIP, { last_active_at: nearly }), T0);
    expect(a.dripActive).toBe(true);
    expect(a.dripped).toBe(CFG.OPT_DRIP_AMOUNT);
  });

  it("pays more at milestone levels and with upgrades bought", () => {
    const plain = accrue(dripAt(DRIP), T0).dripped;
    const levelled = accrue(dripAt(DRIP, { xp: xpForLevel(10) }), T0).dripped;
    const upgraded = accrue(dripAt(DRIP, { drip_upgrades: 2 }), T0).dripped;

    expect(levelled).toBeGreaterThan(plain);
    expect(upgraded).toBe(plain + 2 * CFG.OPT_DRIP_UPGRADE_STEP);
    expect(levelled).toBe(optPerDrip(10, 0));
  });
});
