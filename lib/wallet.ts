import type { PoolClient } from "pg";
import { fail } from "./db";

export type Wallet = { opt: number; portfolio: number; locked: number; spendable: number };

/**
 * One accessor for both economies. matchId === null reads the persistent balances on
 * `users`; otherwise the temporary per-match balances on `match_players`. Every caller
 * goes through here, which is what keeps the two economies from ever touching (§29).
 */
export async function loadWallet(
  c: PoolClient,
  userId: number,
  matchId: number | null
): Promise<Wallet> {
  if (matchId === null) {
    const { rows } = await c.query(
      `SELECT opt, portfolio, locked FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (!rows[0]) fail("player not found");
    const w = rows[0];
    return { ...w, spendable: w.portfolio - w.locked };
  }
  const { rows } = await c.query(
    `SELECT pvp_opt AS opt, pvp_portfolio AS portfolio, pvp_locked AS locked
       FROM match_players WHERE match_id = $1 AND user_id = $2 FOR UPDATE`,
    [matchId, userId]
  );
  if (!rows[0]) fail("player is not in this match");
  const w = rows[0];
  return { ...w, spendable: w.portfolio - w.locked };
}

export async function applyWallet(
  c: PoolClient,
  userId: number,
  matchId: number | null,
  d: { opt?: number; portfolio?: number; locked?: number }
) {
  const o = d.opt ?? 0;
  const p = d.portfolio ?? 0;
  const l = d.locked ?? 0;
  if (matchId === null) {
    await c.query(
      `UPDATE users SET opt = opt + $2, portfolio = portfolio + $3, locked = locked + $4 WHERE id = $1`,
      [userId, o, p, l]
    );
  } else {
    await c.query(
      `UPDATE match_players
          SET pvp_opt = pvp_opt + $3, pvp_portfolio = pvp_portfolio + $4, pvp_locked = pvp_locked + $5
        WHERE match_id = $1 AND user_id = $2`,
      [matchId, userId, o, p, l]
    );
  }
}

export async function addXp(c: PoolClient, userId: number, xp: number) {
  await c.query(`UPDATE users SET xp = xp + $2 WHERE id = $1`, [userId, xp]);
}
