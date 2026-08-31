import { cookies } from "next/headers";
import { GameError, q } from "./db";

const COOKIE = "opt_uid";

export type Me = {
  id: number;
  username: string;
  opt: number;
  portfolio: number;
  locked: number;
  xp: number;
  energy: number;
  // Capacity is derived from level and purchases, so it is not a column here — only the
  // inputs to it are.
  energy_upgrades: number;
  energy_updated_at: string;
  drip_upgrades: number;
  level_seen: number;
};

export async function currentUserId(): Promise<number | null> {
  const c = await cookies();
  const raw = c.get(COOKIE)?.value;
  const id = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(id) ? id : null;
}

export async function setSession(userId: number) {
  const c = await cookies();
  c.set(COOKIE, String(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getMe(): Promise<Me | null> {
  const id = await currentUserId();
  if (!id) return null;
  const [u] = await q<Me>(`SELECT * FROM users WHERE id = $1`, [id]);
  return u ?? null;
}

export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) throw new GameError("Your session expired — sign in again");
  return me;
}
