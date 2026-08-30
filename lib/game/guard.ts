import { GameError } from "@/lib/db";

export type Res = { ok: boolean; message?: string };

/**
 * Turns rule violations into player-facing messages instead of 500s. Anything that isn't a
 * GameError is a genuine fault: log it and say nothing specific to the player.
 */
export async function guard<T extends Res>(fn: () => Promise<T>): Promise<T | Res> {
  try {
    return await fn();
  } catch (e: any) {
    if (e instanceof GameError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Server error" };
  }
}
