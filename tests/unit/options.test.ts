import { describe, expect, it } from "vitest";
import { ASSETS, CFG, EXPIRIES, MAX_EXPIRY_SECONDS, REFERENCE_SECONDS } from "@/lib/config";
import {
  cardValue,
  collateralFor,
  defaultAmount,
  exerciseCost,
  exerciseDeadline,
  exercisePayout,
  exerciseWindowSeconds,
  quotePremium,
  sellLoss,
} from "@/lib/options";

const SPOT = 100;
const AMT = 2;
const base = { asset: "BTC" as const, strike: SPOT, amount: AMT, spot: SPOT };

describe("cardValue", () => {
  it("prices intrinsic value as the in-the-money distance times amount", () => {
    const v = cardValue({ ...base, strike: 90, secondsLeft: 0 });
    expect(v.intrinsic).toBeCloseTo(10 * AMT, 10);
    expect(v.timeValue).toBe(0);
    expect(v.total).toBeCloseTo(20, 10);
  });

  it("has no intrinsic value out of the money", () => {
    const v = cardValue({ ...base, strike: 110, secondsLeft: 0 });
    expect(v.intrinsic).toBe(0);
    expect(v.inTheMoney).toBe(false);
  });

  it("reports moneyness strictly — at the money is not in the money", () => {
    expect(cardValue({ ...base, secondsLeft: 60 }).inTheMoney).toBe(false);
    expect(cardValue({ ...base, strike: 99.99, secondsLeft: 60 }).inTheMoney).toBe(true);
  });

  it("has zero time value at expiry, and never negative before it", () => {
    expect(cardValue({ ...base, secondsLeft: 0 }).timeValue).toBe(0);
    expect(cardValue({ ...base, secondsLeft: -500 }).timeValue).toBe(0);
  });

  it("is exactly linear in amount", () => {
    const one = cardValue({ ...base, amount: 1, secondsLeft: 900 });
    const ten = cardValue({ ...base, amount: 10, secondsLeft: 900 });
    expect(ten.timeValue).toBeCloseTo(one.timeValue * 10, 10);
    expect(ten.total).toBeCloseTo(one.total * 10, 10);
  });

  it("grows with time left, but far more gently than sqrt(T) did", () => {
    const short = cardValue({ ...base, secondsLeft: 120 }).timeValue;
    const long = cardValue({ ...base, secondsLeft: 3600 }).timeValue;
    expect(long).toBeGreaterThan(short);
    // sqrt(T) put this ratio at ~5.5x, which is the bug P9.2 fixed.
    expect(long / short).toBeLessThan(3);
    expect(long / short).toBeGreaterThan(2);
  });

  it("anchors the curve: at the reference horizon an ATM card costs the reference fraction", () => {
    const v = cardValue({ ...base, secondsLeft: REFERENCE_SECONDS });
    const notional = SPOT * AMT;
    const vol = ASSETS.find((a) => a.symbol === "BTC")!.vol;
    expect(v.timeValue / notional).toBeCloseTo(0.026 * vol, 10);
  });

  it("charges more for a more volatile asset on identical terms", () => {
    const btc = cardValue({ ...base, asset: "BTC", secondsLeft: 900 }).timeValue;
    const doge = cardValue({ ...base, asset: "DOGE", secondsLeft: 900 }).timeValue;
    expect(doge).toBeGreaterThan(btc);
  });
});

describe("quotePremium", () => {
  it("converts value to OPT at the configured rate", () => {
    const v = cardValue({ ...base, strike: 90, secondsLeft: 0 });
    expect(quotePremium({ ...base, strike: 90, seconds: 0 }, 5)).toBe(Math.ceil(v.total * 5));
  });

  it("never quotes free, even for a worthless card", () => {
    expect(quotePremium({ ...base, strike: 1e9, seconds: 0 })).toBe(1);
  });

  it("rounds up, so the quote is never below the modelled value", () => {
    for (const secs of [60, 900, 86_400]) {
      const value = cardValue({ ...base, secondsLeft: secs }).total;
      const premium = quotePremium({ ...base, seconds: secs }, CFG.PREMIUM_OPT_PER_DOLLAR);
      expect(premium).toBeGreaterThanOrEqual(value * CFG.PREMIUM_OPT_PER_DOLLAR);
    }
  });

  it("rises monotonically with expiry for every asset and preset", () => {
    for (const a of ASSETS) {
      const spot = 100;
      const amount = defaultAmount(spot);
      let prev = 0;
      for (const e of EXPIRIES) {
        const p = quotePremium(
          { asset: a.symbol, strike: spot, amount, spot, seconds: e.seconds },
          CFG.PREMIUM_OPT_PER_DOLLAR
        );
        expect(p, `${a.symbol} @ ${e.label}`).toBeGreaterThan(prev);
        prev = p;
      }
    }
  });

  it("keeps even a one-month card a sane fraction of notional", () => {
    for (const a of ASSETS) {
      const spot = 100;
      const v = cardValue({
        asset: a.symbol,
        strike: spot,
        amount: 1,
        spot,
        secondsLeft: 30 * 86_400,
      });
      // sqrt(T) against the old 12x vol multiplier wanted ~76% of notional here.
      expect(v.timeValue / spot, a.symbol).toBeLessThan(0.25);
    }
  });
});

describe("collateral, exercise and settlement maths", () => {
  it("collateralises a Sell Option at strike times amount", () => {
    expect(collateralFor(120, 3)).toBe(360);
  });

  it("charges exercise at the configured OPT-per-dollar rate", () => {
    expect(exerciseCost(120, 3)).toBe(360 * CFG.EXERCISE_OPT_PER_DOLLAR);
  });

  it("pays the market value of the position in market mode", () => {
    expect(exercisePayout(100, 2, 130)).toBe(CFG.EXERCISE_PAYOUT_MODE === "strike" ? 200 : 260);
  });

  it("caps a Sell writer's loss at the collateral they locked", () => {
    // Comfortably inside the collateral.
    expect(sellLoss(100, 1, 110, 100)).toBe(10);
    // A move far past the strike still cannot exceed what was locked.
    expect(sellLoss(100, 1, 1000, 100)).toBe(100);
    // Finishing at or below the strike costs nothing.
    expect(sellLoss(100, 1, 100, 100)).toBe(0);
    expect(sellLoss(100, 1, 40, 100)).toBe(0);
  });
});

describe("defaultAmount", () => {
  it("puts a fresh player near a sane notional on any asset", () => {
    for (const spot of [110_000, 4300, 200, 0.22, 23]) {
      const a = defaultAmount(spot);
      expect(a).toBeGreaterThan(0);
      expect(Number.isFinite(a)).toBe(true);
      expect(a * spot).toBeLessThan(4000);
    }
  });
});

describe("the exercise window", () => {
  it("matches the anchors the curve was designed around", () => {
    expect(exerciseWindowSeconds(900)).toBe(300); // a 15m card -> 5 minutes
    expect(exerciseWindowSeconds(3600)).toBe(600); // an hour card -> 10 minutes
  });

  it("grows with the commitment, but never proportionally", () => {
    const ratio = (s: number) => exerciseWindowSeconds(s) / s;
    // A longer card earns more room in absolute terms...
    expect(exerciseWindowSeconds(86400)).toBeGreaterThan(exerciseWindowSeconds(3600));
    // ...and less of it relative to how long it ran.
    expect(ratio(86400)).toBeLessThan(ratio(3600));
    expect(ratio(3600)).toBeLessThan(ratio(900));
  });

  it("never decreases as expiry rises", () => {
    let last = 0;
    for (const s of [60, 300, 900, 3600, 21600, 86400, 604800, 2592000, 31536000]) {
      const w = exerciseWindowSeconds(s);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });

  it("clamps at the configured ceiling past a month", () => {
    expect(exerciseWindowSeconds(2592000 * 2)).toBe(CFG.MAX_EXERCISE_WINDOW_SECONDS);
    expect(exerciseWindowSeconds(MAX_EXPIRY_SECONDS)).toBe(CFG.MAX_EXERCISE_WINDOW_SECONDS);
  });

  it("gives the shortest card the floor rather than seconds", () => {
    // A 1-minute card would get a 20-second window on a proportional curve, which is not
    // enough time to notice, let alone act.
    expect(exerciseWindowSeconds(60)).toBe(300);
  });

  it("runs from settlement, not from expiry", () => {
    // A card settles on whichever poll reaches it, which can be well after it expired. The
    // owner should not lose that gap to our scheduling.
    const created = new Date("2026-01-01T00:00:00Z");
    const expires = new Date("2026-01-01T00:15:00Z"); // ran 15 minutes
    const settled = new Date("2026-01-01T00:47:00Z"); // noticed 32 minutes late
    const deadline = exerciseDeadline(created, expires, settled);
    expect(deadline.getTime() - settled.getTime()).toBe(300_000);
    expect(deadline.getTime()).toBeGreaterThan(expires.getTime());
  });

  it("sizes the window from how long the card ran, not from what is left", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const short = exerciseDeadline(created, new Date("2026-01-01T00:15:00Z"), created);
    const long = exerciseDeadline(created, new Date("2026-01-08T00:00:00Z"), created);
    expect(long.getTime()).toBeGreaterThan(short.getTime());
  });
});
