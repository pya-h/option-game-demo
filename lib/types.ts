import type { AssetSymbol } from "./config";
import type { PublicCfg } from "./public-config";

export type CardStatus = "ACTIVE" | "WON" | "LOST" | "EXERCISED" | "SETTLED" | "LAPSED";

export type CardDTO = {
  id: number;
  match_id: number | null;
  owner_id: number;
  owner: string;
  creator: string;
  kind: "BUY" | "SELL";
  asset: AssetSymbol;
  strike: number;
  amount: number;
  spot_at_create: number;
  premium: number;
  collateral: number;
  created_at: string;
  expires_at: string;
  status: CardStatus;
  settle_price: number | null;
  /** Set when a Buy card settles WON: when the claim stops being available. */
  exercise_deadline: string | null;
  for_sale: boolean;
  ask: number | null;
};

export type PriceDTO = { asset: AssetSymbol; price: number; prev_price: number };

export type MeDTO = {
  id: number;
  username: string;
  opt: number;
  portfolio: number;
  locked: number;
  spendable: number;
  xp: number;
  level: number;
  /** XP into the current level, and the span of that level. */
  levelInto: number;
  levelSpan: number;
  levelPct: number;
  /** A level-up earned but not yet celebrated — XP arrives while nobody is watching. */
  pendingLevelUp: { from: number; to: number } | null;
  energy: number;
  energy_capacity: number;
  nextEnergyMs: number;
  /** OPT drip: how much lands, when the next one is due, and whether it still runs. */
  optPerDrip: number;
  nextOptMs: number;
  dripActive: boolean;
  energyUpgrades: number;
  dripUpgrades: number;
  portfolioRank: number;
  xpRank: number;
  players: number;
};

export type QueueDTO = {
  mode: "DUEL" | "GROUP";
  size: number;
  durationMin: number;
  /** How many players are waiting in this exact bucket, including you. */
  waiting: number;
  queuedAt: string;
};

export type StateDTO = {
  me: MeDTO;
  prices: PriceDTO[];
  cards: CardDTO[];
  pendingInvites: number;
  /** Set while the player is searching for a random match. */
  queue: QueueDTO | null;
  /** A match the player is in that is running right now, matchmade or otherwise. */
  liveMatchId: number | null;
  cfg: PublicCfg;
};

export type CardEventDTO = {
  id: number;
  type: string;
  actor: string | null;
  from_user: string | null;
  to_user: string | null;
  opt_delta: number;
  portfolio_delta: number;
  note: string | null;
  created_at: string;
};

export type MatchDTO = {
  id: number;
  name: string;
  mode: "DUEL" | "GROUP";
  status: "LOBBY" | "ACTIVE" | "FINISHED";
  creator_id: number;
  creator: string;
  duration_min: number;
  started_at: string | null;
  ends_at: string | null;
  created_at: string;
  players: MatchPlayerDTO[];
};

export type MatchPlayerDTO = {
  user_id: number;
  username: string;
  state: "INVITED" | "JOINED" | "DECLINED";
  pvp_opt: number;
  pvp_portfolio: number;
  pvp_locked: number;
  final_rank: number | null;
};

export type PvpStateDTO = {
  match: MatchDTO;
  cards: CardDTO[];
  prices: PriceDTO[];
  meId: number;
  cfg: PublicCfg;
};
