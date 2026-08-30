import { ASSET_MAP, CFG, GAME_VOL_MULTIPLIER, type AssetSymbol } from "./config";

const SECONDS_PER_YEAR = 365 * 24 * 3600;

/**
 * Card value in virtual dollars. Both card kinds are call-shaped (IDEA.md §5/§10),
 * so one model prices both: intrinsic + an ATM Black-Scholes approximation for time value
 * (0.4 * S * sigma * sqrt(T)).
 */
export function cardValue(args: {
  asset: AssetSymbol;
  strike: number;
  amount: number;
  spot: number;
  secondsLeft: number;
}) {
  const { asset, strike, amount, spot } = args;
  const vol = (ASSET_MAP[asset]?.vol ?? 0.8) * GAME_VOL_MULTIPLIER;
  const T = Math.max(0, args.secondsLeft) / SECONDS_PER_YEAR;

  const intrinsic = Math.max(0, spot - strike) * amount;
  const timeValue = 0.4 * spot * amount * vol * Math.sqrt(T);

  return {
    intrinsic,
    timeValue,
    total: intrinsic + timeValue,
    inTheMoney: spot > strike,
  };
}

/**
 * Premium in OPT, frozen at creation. The authoritative call happens server-side; the UI
 * calls it too, for a live quote, passing the rate down from the state payload so the two
 * can never disagree (a client bundle can't see the server env).
 */
export function quotePremium(
  args: { asset: AssetSymbol; strike: number; amount: number; spot: number; seconds: number },
  optPerDollar: number = CFG.PREMIUM_OPT_PER_DOLLAR
) {
  const v = cardValue({ ...args, secondsLeft: args.seconds });
  return Math.max(1, Math.ceil(v.total * optPerDollar));
}

/** Collateral a Sell Option writer must lock (IDEA.md §10): strike * amount. */
export const collateralFor = (strike: number, amount: number) => strike * amount;

/** OPT burned to exercise a winning Buy Option. */
export const exerciseCost = (strike: number, amount: number) =>
  strike * amount * CFG.EXERCISE_OPT_PER_DOLLAR;

/** Portfolio credited on exercise, per EXERCISE_PAYOUT_MODE. */
export const exercisePayout = (strike: number, amount: number, settlePrice: number) =>
  CFG.EXERCISE_PAYOUT_MODE === "strike" ? strike * amount : settlePrice * amount;

/**
 * Loss taken by a Sell Option writer at settlement, capped at the locked collateral
 * so a player can never be pushed negative.
 */
export const sellLoss = (strike: number, amount: number, settlePrice: number, collateral: number) =>
  Math.min(Math.max(0, settlePrice - strike) * amount, collateral);

/** Sensible default amount so a fresh player can actually afford a position on any asset. */
export function defaultAmount(spot: number) {
  const targetNotional = 300;
  const raw = targetNotional / spot;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return Math.max(mag, Math.round(raw / mag) * mag);
}
