/**
 * Card rarity — the collectible grade shown on a card's frame.
 *
 * Deliberately derived only from values frozen at mint (notional, and how far the strike sat
 * from spot at the time), never from the live price. A card that changed grade as the market
 * moved would be worthless as a collectible: rarity has to mean "what it took to make this",
 * not "how it happens to be doing". It carries no mechanical weight — it renames and reframes
 * what the card already shows, so it can never become a second, hidden economy.
 */
import type { CardDTO } from "./types";

export type RarityKey = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";

export type Rarity = {
  key: RarityKey;
  label: string;
  stars: number;
  /** Frame colour. */
  tint: string;
  /** Whether the frame animates. Reserved for the top two grades so it stays special. */
  animated: boolean;
};

export const RARITIES: Record<RarityKey, Rarity> = {
  COMMON: { key: "COMMON", label: "Common", stars: 1, tint: "#8b94ba", animated: false },
  UNCOMMON: { key: "UNCOMMON", label: "Uncommon", stars: 2, tint: "#34d399", animated: false },
  RARE: { key: "RARE", label: "Rare", stars: 3, tint: "#38bdf8", animated: false },
  EPIC: { key: "EPIC", label: "Epic", stars: 4, tint: "#a855f7", animated: true },
  LEGENDARY: { key: "LEGENDARY", label: "Legendary", stars: 5, tint: "#fbbf24", animated: true },
};

const ORDER: RarityKey[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

/**
 * Two things make a card notable, and they're scored separately so neither alone can max it:
 * how much was staked (notional) and how bold the strike was (distance from spot at mint). A
 * default mint — roughly $300 of notional, a percent off spot — lands on Common, so the ladder
 * starts where the game starts.
 */
export function rarityOf(card: Pick<CardDTO, "strike" | "amount" | "spot_at_create">): Rarity {
  const notional = Math.abs(card.strike * card.amount);
  const spot = card.spot_at_create;
  const pct = spot > 0 ? Math.abs((card.strike - spot) / spot) * 100 : 0;

  const size = notional >= 5000 ? 3 : notional >= 1500 ? 2 : notional >= 500 ? 1 : 0;
  const boldness = pct >= 12 ? 2 : pct >= 6 ? 1 : 0;

  return RARITIES[ORDER[Math.min(ORDER.length - 1, size + boldness)]];
}
