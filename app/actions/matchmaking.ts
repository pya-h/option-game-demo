"use server";

/** Authenticated entry points for random matchmaking. Rules live in lib/game/matchmaking.ts. */
import type { Res } from "@/lib/game/guard";
import { type QueueRequest, joinQueueFor, leaveQueueFor } from "@/lib/game/matchmaking";
import { requireMe } from "@/lib/session";

export async function joinQueue(input: QueueRequest): Promise<Res> {
  return joinQueueFor((await requireMe()).id, input);
}

export async function leaveQueue(): Promise<Res> {
  return leaveQueueFor((await requireMe()).id);
}
