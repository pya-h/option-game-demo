import { describe, expect, it } from "vitest";
import { CFG } from "@/lib/config";
import { accrue } from "@/lib/energy";

const STEP = CFG.ENERGY_REFILL_SECONDS * 1000;
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const at = (energy: number, msAgo: number, cap = CFG.INITIAL_ENERGY_CAPACITY) => ({
  energy,
  energy_capacity: cap,
  energy_updated_at: new Date(T0 - msAgo).toISOString(),
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
    expect(a.updatedAt.getTime()).toBe(T0 - STEP * 0.5);
  });

  it("clamps at capacity no matter how long the player was away", () => {
    const a = accrue(at(0, STEP * 10_000), T0);
    expect(a.energy).toBe(CFG.INITIAL_ENERGY_CAPACITY);
  });

  it("reports no next tick once the bar is full", () => {
    expect(accrue(at(CFG.INITIAL_ENERGY_CAPACITY, STEP * 3), T0).nextInMs).toBe(0);
  });

  it("restarts the clock from now when already full, so spending starts a fresh interval", () => {
    const a = accrue(at(CFG.INITIAL_ENERGY_CAPACITY, STEP * 99), T0);
    expect(a.energy).toBe(CFG.INITIAL_ENERGY_CAPACITY);
    expect(a.updatedAt.getTime()).toBe(T0);
  });

  it("counts down to the next point when partway through an interval", () => {
    const a = accrue(at(1, STEP * 0.25), T0);
    expect(a.energy).toBe(1);
    expect(a.nextInMs).toBeGreaterThan(0);
    expect(a.nextInMs).toBeLessThanOrEqual(STEP);
    expect(a.nextInMs).toBeCloseTo(STEP * 0.75, -1);
  });

  it("never moves backwards if the stored clock is in the future", () => {
    const a = accrue(at(5, -STEP * 3), T0);
    expect(a.energy).toBe(5);
  });

  it("honours a raised capacity from an Energy Cell", () => {
    const cap = CFG.INITIAL_ENERGY_CAPACITY + CFG.ENERGY_CELL_STEP;
    const a = accrue(at(CFG.INITIAL_ENERGY_CAPACITY, STEP * 50, cap), T0);
    expect(a.energy).toBe(cap);
  });

  it("leaves a player below a raised starting capacity able to refill to the new one", () => {
    // The case that used to index the Energy Cell price table negatively.
    const a = accrue(at(3, STEP * 10_000, 10), T0);
    expect(a.energy).toBe(10);
  });
});
