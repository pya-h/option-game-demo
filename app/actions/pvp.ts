"use server";

/** Authenticated entry points for PvP. Rules live in lib/game/pvp.ts. */
import {
  type PvpRes,
  createMatchFor,
  endMatchNowFor,
  pvpConvertFor,
  respondInviteFor,
  startMatchFor,
} from "@/lib/game/pvp";
import { requireMe } from "@/lib/session";

export async function createMatch(input: {
  mode: "DUEL" | "GROUP";
  name: string;
  durationMin: number;
  usernames: string[];
}): Promise<PvpRes> {
  return createMatchFor((await requireMe()).id, input);
}

export async function respondInvite(matchId: number, accept: boolean): Promise<PvpRes> {
  return respondInviteFor((await requireMe()).id, matchId, accept);
}

export async function startMatch(matchId: number): Promise<PvpRes> {
  return startMatchFor((await requireMe()).id, matchId);
}

export async function pvpConvert(matchId: number, usdAmount: number): Promise<PvpRes> {
  return pvpConvertFor((await requireMe()).id, matchId, usdAmount);
}

export async function endMatchNow(matchId: number): Promise<PvpRes> {
  return endMatchNowFor((await requireMe()).id, matchId);
}
