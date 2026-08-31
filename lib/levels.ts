/**
 * Player levels.
 *
 * Level is a *reading* of XP, never a stored number. XP only ever goes up and is never spent,
 * so a level derived from it can't drift; storing both would eventually let them disagree, and
 * a level that no longer matches its XP is the kind of bug nobody notices until the leaderboard
 * is wrong. The one thing that genuinely can't be derived — which level the player has actually
 * been *shown* — lives in `users.level_seen`, because XP routinely arrives while nobody is
 * watching and the celebration is owed rather than missed.
 *
 * Everything a level grants is derived here too, for the same reason.
 */
import {
  CFG,
  LEVEL_CAPACITY_PER_LEVEL,
  LEVEL_DRIP_BONUS,
  LEVEL_REFILL_BONUS,
  LEVEL_REWARD_EVERY,
  XP_LEVEL_BASE,
  XP_LEVEL_FACTOR,
} from "./config";

/**
 * Total XP needed to be at level n. Level 1 is free; each step after costs the previous step
 * times FACTOR, so the totals are a geometric series. With the defaults (500, 1.5) that puts
 * level 2 at 500 XP, level 3 at 1,250 and level 4 at 2,375 — roughly five winning cards for
 * the first, which is a pace a new player can feel.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const n = level - 1;
  // Closed form of BASE * (1 + F + F^2 + ... + F^(n-1)); the loop would be fine, but this is
  // called per row when ranking every player on the board.
  const sum =
    XP_LEVEL_FACTOR === 1
      ? n
      : (Math.pow(XP_LEVEL_FACTOR, n) - 1) / (XP_LEVEL_FACTOR - 1);
  return Math.round(XP_LEVEL_BASE * sum);
}

/** The level a given XP total earns. Inverse of xpForLevel, and always at least 1. */
export function levelFor(xp: number): number {
  if (!Number.isFinite(xp) || xp < XP_LEVEL_BASE) return 1;
  // Solved rather than looped so a player who somehow banks a huge total doesn't cost a scan.
  const ratio = (xp * (XP_LEVEL_FACTOR - 1)) / XP_LEVEL_BASE + 1;
  const guess =
    XP_LEVEL_FACTOR === 1
      ? Math.floor(xp / XP_LEVEL_BASE) + 1
      : Math.floor(Math.log(ratio) / Math.log(XP_LEVEL_FACTOR)) + 1;

  // Nudge off the closed form's floating-point edges: exactly-on-threshold XP must land on the
  // level it just bought, not a hair below it.
  let level = Math.max(1, guess);
  while (xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  return level;
}

export type LevelProgress = {
  level: number;
  xp: number;
  /** XP into the current level, and how much that level costs end to end. */
  into: number;
  span: number;
  /** Still to earn before the next level. 0 only at the very start. */
  remaining: number;
  pct: number;
};

export function levelProgress(xp: number): LevelProgress {
  const level = levelFor(xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const into = Math.max(0, xp - floor);
  return {
    level,
    xp,
    into,
    span,
    remaining: Math.max(0, ceil - xp),
    pct: Math.min(100, (into / span) * 100),
  };
}

// ---------------------------------------------------------------- what a level is worth

/** Levels at or below `level` that paid the milestone reward. Level 1 pays nothing. */
const milestones = (level: number) => Math.floor(level / LEVEL_REWARD_EVERY);

/**
 * Energy capacity: the starting bar, plus every upgrade bought, plus one per level.
 *
 * Both halves matter and they must stay separable. The store prices its next upgrade from how
 * many have been *bought*, so deriving that from total capacity — as it used to — would read
 * level bonuses as purchases and charge a high-level player who owns nothing for a tier they
 * never bought.
 */
export const energyCapacity = (level: number, upgradesBought: number) =>
  CFG.INITIAL_ENERGY_CAPACITY +
  upgradesBought * CFG.ENERGY_CELL_STEP +
  (level - 1) * LEVEL_CAPACITY_PER_LEVEL;

/** Energy granted per refill tick — one, plus one per milestone level. */
export const energyPerTick = (level: number) => 1 + milestones(level) * LEVEL_REFILL_BONUS;

/** OPT granted per drip, from the base amount plus milestones plus anything bought. */
export const optPerDrip = (level: number, dripUpgrades: number) =>
  CFG.OPT_DRIP_AMOUNT +
  milestones(level) * LEVEL_DRIP_BONUS +
  dripUpgrades * CFG.OPT_DRIP_UPGRADE_STEP;

/** Everything `level` unlocked, phrased for the level-up modal. Empty on a plain level. */
export function rewardsAt(level: number): string[] {
  const out = [`+${LEVEL_CAPACITY_PER_LEVEL} max Energy`];
  if (level % LEVEL_REWARD_EVERY === 0) {
    out.push(`+${LEVEL_REFILL_BONUS} Energy per refill`);
    out.push(`+${LEVEL_DRIP_BONUS} OPT per drop`);
  }
  return out;
}
