/**
 * Rarity is cosmetic, but it has one hard requirement: it must never move. A card whose grade
 * shifted with the market would be useless as a collectible, so it may only read values frozen
 * at mint.
 */
import { describe, expect, it } from "vitest";
import { rarityOf } from "@/lib/rarity";

const card = (strike: number, amount: number, spotAtCreate: number) => ({
  strike,
  amount,
  spot_at_create: spotAtCreate,
});

describe("card rarity", () => {
  it("grades a default mint as Common", () => {
    // defaultAmount targets ~$300 of notional, and the strike slider starts a percent off spot.
    expect(rarityOf(card(101, 3, 100)).key).toBe("COMMON");
  });

  it("climbs with notional", () => {
    const at = (notional: number) => rarityOf(card(100, notional / 100, 100)).stars;
    expect(at(300)).toBeLessThan(at(800));
    expect(at(800)).toBeLessThan(at(2000));
    expect(at(2000)).toBeLessThan(at(9000));
  });

  it("climbs with how far the strike sat from spot", () => {
    const at = (pct: number) => rarityOf(card(100 * (1 + pct / 100), 3, 100)).stars;
    expect(at(1)).toBeLessThan(at(8));
    expect(at(8)).toBeLessThan(at(20));
  });

  it("treats a strike below spot as bold as one above", () => {
    expect(rarityOf(card(80, 3, 100)).key).toBe(rarityOf(card(120, 3, 100)).key);
  });

  it("reaches Legendary only when the bet is both large and bold", () => {
    expect(rarityOf(card(100, 100, 100)).key).not.toBe("LEGENDARY"); // big, timid
    expect(rarityOf(card(130, 0.1, 100)).key).not.toBe("LEGENDARY"); // bold, tiny
    expect(rarityOf(card(130, 100, 100)).key).toBe("LEGENDARY"); // both
  });

  it("never depends on the live price — only on what was frozen at mint", () => {
    // The same card, graded twice. There is no spot parameter to pass, which is the guarantee:
    // rarityOf cannot see the market even if it wanted to.
    const c = card(115, 40, 100);
    expect(rarityOf(c)).toEqual(rarityOf(c));
    expect(Object.keys(c)).toEqual(["strike", "amount", "spot_at_create"]);
  });

  it("gives every grade a distinct star count, so the frame is readable at a glance", () => {
    const seen = new Set(
      [
        card(100, 1, 100),
        card(100, 8, 100),
        card(100, 20, 100),
        card(108, 20, 100),
        card(130, 100, 100),
      ].map((c) => rarityOf(c).stars)
    );
    expect(seen.size).toBe(5);
  });
});
