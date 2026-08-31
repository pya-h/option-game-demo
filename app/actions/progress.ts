"use server";

/** Authenticated entry point for progression. Rules live in lib/levels.ts. */
import { q } from "@/lib/db";
import { levelFor } from "@/lib/levels";
import { requireMe } from "@/lib/session";

/**
 * Marks a level-up as seen, after the client has actually shown it.
 *
 * Recomputed from XP rather than taking a level from the caller: the client may only ever
 * acknowledge the level the player has genuinely earned, and clamping to `levelFor(xp)` means
 * a forged call can't skip the celebrations in between either.
 */
export async function acknowledgeLevel(): Promise<{ ok: boolean }> {
  const me = await requireMe();
  await q(`UPDATE users SET level_seen = $2 WHERE id = $1 AND level_seen < $2`, [
    me.id,
    levelFor(Number(me.xp)),
  ]);
  return { ok: true };
}
