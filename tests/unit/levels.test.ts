/**
 * The level curve.
 *
 * The property that matters most is that `levelFor` and `xpForLevel` are exact inverses at
 * every boundary. Level is derived from XP on every read — the resource bar, the leaderboard,
 * the capacity calculation — so an off-by-one at a threshold would show a player a level they
 * hadn't earned, or withhold one they had.
 */
import { describe, expect, it } from "vitest";
import { CFG, LEVEL_REWARD_EVERY, XP_LEVEL_BASE, XP_LEVEL_FACTOR } from "@/lib/config";
import {
  energyCapacity,
  energyPerTick,
  levelFor,
  levelProgress,
  optPerDrip,
  rewardsAt,
  xpForLevel,
} from "@/lib/levels";

describe("the level curve", () => {
  it("starts everyone at level 1 with no XP", () => {
    expect(levelFor(0)).toBe(1);
    expect(xpForLevel(1)).toBe(0);
  });

  it("costs BASE to reach level 2", () => {
    expect(xpForLevel(2)).toBe(XP_LEVEL_BASE);
    expect(levelFor(XP_LEVEL_BASE - 1)).toBe(1);
    expect(levelFor(XP_LEVEL_BASE)).toBe(2);
  });

  it("multiplies each step by the factor", () => {
    for (let n = 2; n < 12; n++) {
      const step = xpForLevel(n + 1) - xpForLevel(n);
      const prev = xpForLevel(n) - xpForLevel(n - 1);
      expect(step / prev).toBeCloseTo(XP_LEVEL_FACTOR, 2);
    }
  });

  it("is an exact inverse at every threshold", () => {
    for (let n = 1; n <= 40; n++) {
      const need = xpForLevel(n);
      expect(levelFor(need)).toBe(n); // exactly on the threshold buys the level
      if (n > 1) expect(levelFor(need - 1)).toBe(n - 1); // a point short does not
    }
  });

  it("never goes backwards as XP rises", () => {
    let last = 1;
    for (let xp = 0; xp < 400_000; xp += 137) {
      const l = levelFor(xp);
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
  });

  it("survives nonsense by falling back to level 1 rather than hanging or returning NaN", () => {
    // Infinity is included on purpose: the closed form would hand the correction loop an
    // infinite target and it would never terminate. Non-finite XP is garbage either way, and
    // the safe answer is the floor.
    for (const bad of [NaN, -1, -Infinity, Infinity]) {
      expect(levelFor(bad as number)).toBe(1);
    }
  });

  it("reaches the first level in a handful of winning cards", () => {
    // The pace a new player feels. Five wins should do it, not fifty.
    const winsToLevel2 = Math.ceil(xpForLevel(2) / CFG.SUCCESSFUL_OPTION_XP);
    expect(winsToLevel2).toBeGreaterThanOrEqual(3);
    expect(winsToLevel2).toBeLessThanOrEqual(8);
  });
});

describe("level progress", () => {
  it("reports how far into the current level a player is", () => {
    const p = levelProgress(XP_LEVEL_BASE);
    expect(p.level).toBe(2);
    expect(p.into).toBe(0);
    expect(p.pct).toBe(0);
    expect(p.remaining).toBe(xpForLevel(3) - XP_LEVEL_BASE);
  });

  it("fills the bar as the next level approaches", () => {
    const half = xpForLevel(3) - Math.floor((xpForLevel(3) - xpForLevel(2)) / 2);
    const p = levelProgress(half);
    expect(p.level).toBe(2);
    expect(p.pct).toBeGreaterThan(45);
    expect(p.pct).toBeLessThan(55);
  });

  it("never reports a percentage outside the bar", () => {
    for (let xp = 0; xp < 200_000; xp += 971) {
      const p = levelProgress(xp);
      expect(p.pct).toBeGreaterThanOrEqual(0);
      expect(p.pct).toBeLessThanOrEqual(100);
    }
  });
});

describe("what a level is worth", () => {
  it("adds one Energy capacity per level", () => {
    expect(energyCapacity(1, 0)).toBe(CFG.INITIAL_ENERGY_CAPACITY);
    expect(energyCapacity(10, 0)).toBe(CFG.INITIAL_ENERGY_CAPACITY + 9);
  });

  it("adds bought capacity on top, separately", () => {
    expect(energyCapacity(10, 3)).toBe(
      CFG.INITIAL_ENERGY_CAPACITY + 9 + 3 * CFG.ENERGY_CELL_STEP
    );
  });

  it("raises the refill only at milestone levels", () => {
    expect(energyPerTick(1)).toBe(1);
    expect(energyPerTick(LEVEL_REWARD_EVERY - 1)).toBe(1);
    expect(energyPerTick(LEVEL_REWARD_EVERY)).toBe(2);
    expect(energyPerTick(LEVEL_REWARD_EVERY * 3)).toBe(4);
  });

  it("raises the drip at milestone levels and with upgrades", () => {
    expect(optPerDrip(1, 0)).toBe(CFG.OPT_DRIP_AMOUNT);
    expect(optPerDrip(LEVEL_REWARD_EVERY, 0)).toBeGreaterThan(optPerDrip(1, 0));
    expect(optPerDrip(1, 2)).toBe(CFG.OPT_DRIP_AMOUNT + 2 * CFG.OPT_DRIP_UPGRADE_STEP);
  });

  it("names something on every level, and more on a milestone", () => {
    expect(rewardsAt(2).length).toBe(1);
    expect(rewardsAt(LEVEL_REWARD_EVERY).length).toBeGreaterThan(1);
  });
});
