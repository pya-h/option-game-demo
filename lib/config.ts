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

export const CFG = {
  INITIAL_OPT_BALANCE: num("INITIAL_OPT_BALANCE", 10000),
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
  PVP_WIN_XP: num("PVP_WIN_XP", 500),

  PVP_INITIAL_OPT: num("PVP_INITIAL_OPT", 10000),
  PVP_WIN_OPT_REWARD: num("PVP_WIN_OPT_REWARD", 300),
  PVP_WIN_PORTFOLIO_REWARD: num("PVP_WIN_PORTFOLIO_REWARD", 250),

  // Scaled to the 50-point bar: +2 per cell would have been noise against it, and a full
  // refill is worth five times what it was.
  ENERGY_CELL_PRICES: list("ENERGY_CELL_PRICES", [600, 1100, 1800, 2800]),
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

/**
 * Gap an in-match option must leave between its expiry and the final whistle. A card settling
 * in the same instant the match finalises would count or not depending on which transaction
 * landed first; this makes the answer never depend on that race.
 */
export const MATCH_EXPIRY_MARGIN_SECONDS = 10;
