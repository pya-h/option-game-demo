/**
 * The exchange-rate identity, as an explicit regression.
 *
 * OPT and virtual dollars are related by one rate used in three places: burning Portfolio for
 * OPT, paying a premium, and paying to exercise. If those three ever drift apart, a player can
 * burn Portfolio into OPT, buy a deep in-the-money card, exercise it, and come out ahead — a
 * risk-free pump that quietly ruins the leaderboard. It shipped that way once. It must not again.
 */
import { describe, expect, it } from "vitest";
import { ASSETS, CFG, EXPIRIES } from "@/lib/config";
import { defaultAmount, exerciseCost, exercisePayout, quotePremium } from "@/lib/options";

describe("OPT <-> dollar exchange rate", () => {
  it("is a single rate shared by conversion, premium and exercise", () => {
    expect(CFG.PORTFOLIO_TO_OPT_RATIO).toBe(CFG.EXERCISE_OPT_PER_DOLLAR);
    expect(CFG.PORTFOLIO_TO_OPT_RATIO).toBe(CFG.PREMIUM_OPT_PER_DOLLAR);
  });
});

/**
 * Walks the full cycle in virtual dollars:
 *   burn $X -> X*rate OPT -> pay the premium -> pay the exercise cost -> receive Portfolio.
 * Prices are held flat, which is the attacker's best case: a deep in-the-money card whose
 * intrinsic value is already known and cannot move against them.
 */
function cycleProfit(opts: {
  asset: (typeof ASSETS)[number]["symbol"];
  spot: number;
  strikePct: number;
  seconds: number;
}) {
  const { asset, spot, strikePct, seconds } = opts;
  const amount = defaultAmount(spot);
  const strike = spot * (1 + strikePct / 100);

  const premiumOpt = quotePremium(
    { asset, strike, amount, spot, seconds },
    CFG.PREMIUM_OPT_PER_DOLLAR
  );
  const exerciseOpt = exerciseCost(strike, amount);
  // Settles flat, so the card is worth exactly its intrinsic value.
  const payoutUsd = exercisePayout(strike, amount, spot);

  const spentUsd = (premiumOpt + exerciseOpt) / CFG.PORTFOLIO_TO_OPT_RATIO;
  return payoutUsd - spentUsd;
}

describe("burn-to-OPT round trip", () => {
  it("never turns a profit, for any asset, expiry or moneyness", () => {
    for (const a of ASSETS) {
      for (const e of EXPIRIES) {
        // Deep in the money is where the pump was profitable before the rates were pinned.
        for (const pct of [-30, -20, -10, -5, -1, 0, 5]) {
          const profit = cycleProfit({
            asset: a.symbol,
            spot: 100,
            strikePct: pct,
            seconds: e.seconds,
          });
          expect(profit, `${a.symbol} ${e.label} strike${pct}%`).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("costs the player the time value they paid for — that is the whole spread", () => {
    // Buying deep ITM and exercising immediately should lose roughly the time value.
    const loss = -cycleProfit({ asset: "BTC", spot: 100, strikePct: -20, seconds: 900 });
    expect(loss).toBeGreaterThan(0);
  });

  it("would be profitable if the rates ever drifted — proving the test can fail", () => {
    // Reproduces the original bug: converting at 5 OPT/$ while exercising at 1 OPT/$.
    const spot = 100;
    const amount = defaultAmount(spot);
    const strike = spot * 0.8;
    const premiumOpt = quotePremium({ asset: "BTC", strike, amount, spot, seconds: 900 }, 1);
    const exerciseOptDrifted = strike * amount * 1;
    const payoutUsd = spot * amount;
    const spentUsd = (premiumOpt + exerciseOptDrifted) / 5;
    expect(payoutUsd - spentUsd).toBeGreaterThan(0);
  });
});
