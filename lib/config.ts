// Every balance-affecting knob lives here (IDEA.md §33). Nothing is hard-coded downstream.

const num = (k: string, d: number) => {
  const v = process.env[k];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

const list = (k: string, d: number[]) => {
  const v = process.env[k];
  if (!v) return d;
  const parts = v.split(",").map((s) => Number(s.trim()));
  return parts.every((n) => Number.isFinite(n)) && parts.length ? parts : d;
};

/**
 * Time-value curve for the premium model.
 *
 * Black-Scholes time value grows as sqrt(T), which is right for a real option and wrong for
 * this game twice over: over a 2-minute horizon it prices a card at roughly nothing, and over
 * a 1-month horizon (which the main game now allows) it wanted 76% of notional. Scaling
 * volatility up to fix the first end only made the second end worse.
 *
 * So the curve is anchored rather than derived. TIME_VALUE_AT_REFERENCE is the fraction of
 * notional an at-the-money card costs at REFERENCE_SECONDS for an asset with vol 1.0, and
 * TIME_VALUE_EXPONENT sets how fast it grows from there. At 0.25 a 1h card costs ~2.3x a 2m
 * card rather than ~5.5x, and a 1-month card lands near 10% of notional — expiry still
 * matters, it just no longer dominates every other choice on the card.
 *
 * Deliberately plain constants, not env knobs: the pricing model runs on both the server
 * (authoritative) and the client (live quotes), and a client bundle can't read the server env,
 * so env-driven values here would silently quote two different numbers.
 */
export const REFERENCE_SECONDS = 900;
export const TIME_VALUE_AT_REFERENCE = 0.026;
export const TIME_VALUE_EXPONENT = 0.25;

/**
 * Level curve. The XP needed to reach level n is a geometric series: the step from one level
 * to the next is the previous step times FACTOR. XP itself is never spent or reset — the level
 * is a reading of it, so the two can never disagree.
 *
 * Plain constants for the same reason the pricing curve is: the curve runs on the client (the
 * progress bar, the level-up modal) and a client bundle can't read the server env.
 */
export const XP_LEVEL_BASE: number = 500;
export const XP_LEVEL_FACTOR: number = 1.5;

/**
 * How long a winning card may be claimed after it settles, by how long it originally ran.
 *
 * A win that could be exercised forever is a free option with no cost to holding it. The scale
 * is sublinear on purpose — a 15-minute card gives 5 minutes and an hour-long card 10, so a
 * longer commitment buys more room to notice, but never proportionally more.
 */
export const EXERCISE_WINDOWS: { maxExpiry: number; window: number }[] = [
  { maxExpiry: 900, window: 300 }, //      <= 15m -> 5m
  { maxExpiry: 3600, window: 600 }, //      <= 1h -> 10m
  { maxExpiry: 21600, window: 1800 }, //    <= 6h -> 30m
  { maxExpiry: 86400, window: 3600 }, //    <= 1d -> 1h
  { maxExpiry: 604800, window: 7200 }, //   <= 1w -> 2h
  { maxExpiry: 2592000, window: 14400 }, // <= 30d -> 4h
];

/** Levels that pay the bigger rewards, and what those rewards are. */
export const LEVEL_REWARD_EVERY: number = 5;
export const LEVEL_CAPACITY_PER_LEVEL: number = 1;
export const LEVEL_REFILL_BONUS: number = 1;
export const LEVEL_DRIP_BONUS: number = 5;

export const CFG = {
  INITIAL_OPT_BALANCE: num("INITIAL_OPT_BALANCE", 50000),
  PORTFOLIO_TO_OPT_RATIO: num("PORTFOLIO_TO_OPT_RATIO", 5),
  EXERCISE_OPT_PER_DOLLAR: num("EXERCISE_OPT_PER_DOLLAR", 5),
  // "market": exercising credits settle_price * amount (real call payoff).
  // "strike": credits strike * amount (the literal IDEA.md §4 reading).
  EXERCISE_PAYOUT_MODE: (process.env.EXERCISE_PAYOUT_MODE === "strike" ? "strike" : "market") as
    | "market"
    | "strike",
  PREMIUM_OPT_PER_DOLLAR: num("PREMIUM_OPT_PER_DOLLAR", 5),

  // 50 cards' worth of runway. Ten was enough to hit the throttle before the game had
  // finished explaining itself, which reads as broken rather than as a limit.
  INITIAL_ENERGY_CAPACITY: num("INITIAL_ENERGY_CAPACITY", 50),
  ENERGY_REFILL_SECONDS: num("ENERGY_REFILL_SECONDS", 300),
  OPTION_ENERGY_COST: num("OPTION_ENERGY_COST", 1),
  // A match is a bigger commitment than a card, so it costs 10x one — a fifth of a full bar.
  PVP_ENERGY_COST: num("PVP_ENERGY_COST", 10),

  SUCCESSFUL_OPTION_XP: num("SUCCESSFUL_OPTION_XP", 100),
  // Paid on top of the settlement XP, so letting a window lapse costs position on both
  // leaderboards rather than only on Portfolio.
  EXERCISE_XP: num("EXERCISE_XP", 40),
  PVP_WIN_XP: num("PVP_WIN_XP", 500),

  /**
   * A trickle of OPT so a player with no OPT and no Portfolio has a way back in rather than a
   * dead account. Gated on having played recently: uncapped income for an idle account would
   * pay more for walking away than for playing.
   */
  OPT_DRIP_AMOUNT: num("OPT_DRIP_AMOUNT", 250),
  OPT_DRIP_IDLE_DAYS: num("OPT_DRIP_IDLE_DAYS", 7),
  /** One-time purchases that permanently raise the drip. Repeatable would compound. */
  OPT_DRIP_UPGRADE_PRICES: list("OPT_DRIP_UPGRADE_PRICES", [900, 2000, 4200]),
  OPT_DRIP_UPGRADE_STEP: num("OPT_DRIP_UPGRADE_STEP", 50),

  /** Ceiling on the exercise window, whatever the curve above would otherwise give. */
  MAX_EXERCISE_WINDOW_SECONDS: num("MAX_EXERCISE_WINDOW_SECONDS", 21600),

  PVP_INITIAL_OPT: num("PVP_INITIAL_OPT", 20000),
  PVP_WIN_OPT_REWARD: num("PVP_WIN_OPT_REWARD", 300),
  PVP_WIN_PORTFOLIO_REWARD: num("PVP_WIN_PORTFOLIO_REWARD", 250),

  // Three ways to buy Energy, so the choice is a real one rather than a single upgrade path.
  // A Capacity Chip raises the ceiling. A Charge fills what you already have. An Energy Cell
  // does both and is priced below the two bought separately — every tier saves $100, which is
  // what makes it a bundle rather than just the expensive option.
  //
  // Both upgrades share one tier index, derived from how far capacity sits above the starting
  // value, so buying either advances the price of the next one.
  ENERGY_CELL_PRICES: list("ENERGY_CELL_PRICES", [700, 1100, 1700, 2500]),
  ENERGY_CAPACITY_PRICES: list("ENERGY_CAPACITY_PRICES", [400, 800, 1400, 2200]),
  ENERGY_CELL_STEP: num("ENERGY_CELL_STEP", 10),
  ENERGY_CHARGE_PRICE: num("ENERGY_CHARGE_PRICE", 400),
};

export type AssetSymbol = "BTC" | "ETH" | "SOL" | "BNB" | "XRP" | "DOGE" | "AVAX" | "LINK";

export const ASSETS: {
  symbol: AssetSymbol;
  name: string;
  geckoId: string;
  loreId: string;
  vol: number; // annualised vol used by the premium model
  tint: string; // tailwind-ish hex used for card foil
}[] = [
  { symbol: "BTC", name: "Bitcoin", geckoId: "bitcoin", loreId: "90", vol: 0.55, tint: "#f7931a" },
  { symbol: "ETH", name: "Ethereum", geckoId: "ethereum", loreId: "80", vol: 0.7, tint: "#8a92f5" },
  { symbol: "SOL", name: "Solana", geckoId: "solana", loreId: "48543", vol: 0.95, tint: "#14f195" },
  { symbol: "BNB", name: "BNB", geckoId: "binancecoin", loreId: "2710", vol: 0.65, tint: "#f3ba2f" },
  { symbol: "XRP", name: "XRP", geckoId: "ripple", loreId: "58", vol: 0.9, tint: "#33b5e0" },
  { symbol: "DOGE", name: "Dogecoin", geckoId: "dogecoin", loreId: "2", vol: 1.1, tint: "#c3a634" },
  { symbol: "AVAX", name: "Avalanche", geckoId: "avalanche-2", loreId: "44883", vol: 1.0, tint: "#e84142" },
  { symbol: "LINK", name: "Chainlink", geckoId: "chainlink", loreId: "2751", vol: 0.9, tint: "#2a5ada" },
];

export const ASSET_MAP = Object.fromEntries(ASSETS.map((a) => [a.symbol, a])) as Record<
  AssetSymbol,
  (typeof ASSETS)[number]
>;

/**
 * Expiry presets, in seconds. In the main game these are shortcuts, not limits — how long to
 * commit for is the player's call, and anything between the bounds below is accepted. The
 * short end is still listed first so a demo session shows cards actually resolving.
 */
export const EXPIRIES = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 21600 },
  { label: "1d", seconds: 86400 },
  { label: "1w", seconds: 604800 },
  { label: "1M", seconds: 2592000 },
];

/**
 * Bounds on a custom expiry. The floor keeps a card from expiring before the poll that would
 * settle it; the ceiling exists only because expires_at is a real timestamp and the pricing
 * model needs a finite horizon — it is deliberately far past anything a player would pick.
 */
export const MIN_EXPIRY_SECONDS = 60;
export const MAX_EXPIRY_SECONDS = 365 * 24 * 3600;

/** Units offered by the custom-expiry input, and by the custom match-duration input. */
export const DURATION_UNITS = [
  { label: "min", seconds: 60 },
  { label: "hours", seconds: 3600 },
  { label: "days", seconds: 86400 },
  { label: "weeks", seconds: 604800 },
];

/**
 * Match length presets, in minutes, plus the bounds a custom length is clamped to. Unlike the
 * main game a match is capped: it holds a sealed economy open and every card inside it has to
 * resolve before the final whistle, so it can't run indefinitely.
 */
export const MATCH_DURATIONS = [5, 15, 30, 60, 120, 240];
export const MIN_MATCH_MINUTES = 5;
export const MAX_MATCH_MINUTES = 240;

/** Group sizes a player can queue for. Everyone in a bucket asked for the same number. */
export const GROUP_SIZES = [3, 4, 5, 6];

/**
 * How long a queued player is kept without a heartbeat. The polling client refreshes it, so
 * this only expires someone who closed the tab — otherwise they would hold a seat in a bucket
 * that could never fill. Nothing is charged until a match forms, so there is nothing to refund.
 */
export const QUEUE_TIMEOUT_SECONDS = 45;

/**
 * Gap an in-match option must leave between its expiry and the final whistle. A card settling
 * in the same instant the match finalises would count or not depending on which transaction
 * landed first; this makes the answer never depend on that race.
 */
export const MATCH_EXPIRY_MARGIN_SECONDS = 10;
