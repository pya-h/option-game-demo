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
 * Volatility multiplier applied to the pricing model. Real annualised vol over a 2-15 minute
 * option produces a premium of roughly nothing, which would make writing Sell Options
 * pointless and Buy Options free. This scales time value up to game pace.
 *
 * Deliberately a plain constant, not an env knob: the pricing model runs on both the server
 * (authoritative) and the client (live quotes), and a client bundle can't read the server env,
 * so an env-driven value here would silently quote two different numbers.
 */
export const GAME_VOL_MULTIPLIER = 12;

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

  INITIAL_ENERGY_CAPACITY: num("INITIAL_ENERGY_CAPACITY", 10),
  ENERGY_REFILL_SECONDS: num("ENERGY_REFILL_SECONDS", 300),
  OPTION_ENERGY_COST: num("OPTION_ENERGY_COST", 1),
  PVP_ENERGY_COST: num("PVP_ENERGY_COST", 5),

  SUCCESSFUL_OPTION_XP: num("SUCCESSFUL_OPTION_XP", 100),
  PVP_WIN_XP: num("PVP_WIN_XP", 500),

  PVP_INITIAL_OPT: num("PVP_INITIAL_OPT", 10000),
  PVP_WIN_OPT_REWARD: num("PVP_WIN_OPT_REWARD", 300),
  PVP_WIN_PORTFOLIO_REWARD: num("PVP_WIN_PORTFOLIO_REWARD", 250),

  ENERGY_CELL_PRICES: list("ENERGY_CELL_PRICES", [500, 900, 1500, 2400]),
  ENERGY_CELL_STEP: num("ENERGY_CELL_STEP", 2),
  ENERGY_CHARGE_PRICE: num("ENERGY_CHARGE_PRICE", 200),
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

// Expiry choices, in seconds. Short by design so a demo session shows cards actually resolve.
export const EXPIRIES = [
  { label: "2m", seconds: 120 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
];

export const MATCH_DURATIONS = [5, 10, 15, 30];
