"use server";

/**
 * Authenticated entry points for card actions.
 *
 * These are the only card mutations reachable over the wire. Each one resolves the caller from
 * their session and hands off to lib/game, which holds the rules and takes an explicit userId.
 * The split matters for safety as much as for tidiness: every export of a "use server" module
 * becomes a public endpoint, so a rules function taking a userId must never live in this file.
 */
import {
  type CreateInput,
  acquireCardFor,
  cardHistory as cardHistoryQuery,
  createCardFor,
  exerciseCardFor,
  listCardFor,
  unlistCardFor,
} from "@/lib/game/cards";
import type { Res } from "@/lib/game/guard";
import { requireMe } from "@/lib/session";
import type { CardEventDTO } from "@/lib/types";

export type { CreateInput };

export async function createCard(input: CreateInput): Promise<Res> {
  return createCardFor((await requireMe()).id, input);
}

/** `fund` opts into burning Portfolio to cover a shortfall — never implicit, it costs rank. */
export async function exerciseCard(cardId: number, fund = false): Promise<Res> {
  return exerciseCardFor((await requireMe()).id, cardId, { fund });
}

export async function listCard(cardId: number, ask?: number | null): Promise<Res> {
  return listCardFor((await requireMe()).id, cardId, ask);
}

export async function unlistCard(cardId: number): Promise<Res> {
  return unlistCardFor((await requireMe()).id, cardId);
}

export async function acquireCard(cardId: number): Promise<Res> {
  return acquireCardFor((await requireMe()).id, cardId);
}

/** Public by design — the premium and ownership history of a card is open to everyone (§9). */
export async function cardHistory(cardId: number): Promise<CardEventDTO[]> {
  return cardHistoryQuery(cardId);
}
