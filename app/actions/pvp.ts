"use server";

import { CFG, MAX_MATCH_MINUTES, MIN_MATCH_MINUTES } from "@/lib/config";
import { GameError, fail, q, tx } from "@/lib/db";
import { spendEnergy } from "@/lib/energy";
import { getPrices } from "@/lib/prices";
import { requireMe } from "@/lib/session";
import { finalizeMatchInTx } from "@/lib/settle";

type Res = { ok: boolean; message?: string; matchId?: number };

async function guard<T extends Res>(fn: () => Promise<T>): Promise<T | Res> {
  try {
    return await fn();
  } catch (e: any) {
    if (e instanceof GameError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Server error" };
  }
}

/**
 * Creates a lobby and invites players by username (§19). The creator joins immediately —
 * which is what charges their Energy — so a 1v1 is just a GROUP of two.
 */
export async function createMatch(input: {
  mode: "DUEL" | "GROUP";
  name: string;
  durationMin: number;
  usernames: string[];
}): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    // Presets are shortcuts; any whole number of minutes inside the bounds is allowed.
    const durationMin = Math.round(input.durationMin);
    if (!Number.isFinite(durationMin)) fail("invalid match duration");
    if (durationMin < MIN_MATCH_MINUTES) fail(`The shortest match is ${MIN_MATCH_MINUTES} minutes`);
    if (durationMin > MAX_MATCH_MINUTES)
      fail(`The longest match is ${MAX_MATCH_MINUTES / 60} hours`);

    const wanted = [...new Set(input.usernames.map((u) => u.trim()).filter(Boolean))].filter(
      (u) => u.toLowerCase() !== me.username.toLowerCase()
    );
    if (!wanted.length) fail("Invite at least one other player");
    if (input.mode === "DUEL" && wanted.length !== 1) fail("A 1v1 takes exactly one opponent");

    const found = await q<{ id: number; username: string }>(
      `SELECT id, username FROM users WHERE lower(username) = ANY($1::text[])`,
      [wanted.map((u) => u.toLowerCase())]
    );
    const missing = wanted.filter(
      (u) => !found.some((f) => f.username.toLowerCase() === u.toLowerCase())
    );
    if (missing.length) fail(`No such player: ${missing.join(", ")}`);

    const name = (input.name.trim() || `${me.username}'s Arena`).slice(0, 40);

    return await tx(async (c) => {
      // Joining costs main-game Energy (§22); the creator pays it up front.
      await spendEnergy(c, me.id, CFG.PVP_ENERGY_COST);

      const { rows } = await c.query(
        `INSERT INTO matches (name, creator_id, mode, duration_min) VALUES ($1,$2,$3,$4) RETURNING id`,
        [name, me.id, input.mode, durationMin]
      );
      const matchId = rows[0].id;

      await c.query(
        `INSERT INTO match_players (match_id, user_id, state, pvp_opt, pvp_portfolio, joined_at)
         VALUES ($1,$2,'JOINED',$3,0,now())`,
        [matchId, me.id, CFG.PVP_INITIAL_OPT]
      );
      for (const f of found) {
        await c.query(
          `INSERT INTO match_players (match_id, user_id, state) VALUES ($1,$2,'INVITED')`,
          [matchId, f.id]
        );
      }
      return { ok: true, matchId, message: `${name} created · −${CFG.PVP_ENERGY_COST} Energy` };
    });
  });
}

/** Accepting charges main Energy and grants the equal starting PvP balances (§20). */
export async function respondInvite(matchId: number, accept: boolean): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    return await tx(async (c) => {
      const { rows: m } = await c.query(`SELECT status FROM matches WHERE id = $1 FOR UPDATE`, [
        matchId,
      ]);
      if (!m[0]) fail("match not found");
      if (m[0].status !== "LOBBY") fail("This match has already started");

      const { rows: mp } = await c.query(
        `SELECT state FROM match_players WHERE match_id = $1 AND user_id = $2 FOR UPDATE`,
        [matchId, me.id]
      );
      if (!mp[0]) fail("you were not invited to this match");
      if (mp[0].state !== "INVITED") fail("you already responded");

      if (!accept) {
        await c.query(
          `UPDATE match_players SET state = 'DECLINED' WHERE match_id = $1 AND user_id = $2`,
          [matchId, me.id]
        );
        return { ok: true, message: "Invite declined" };
      }

      await spendEnergy(c, me.id, CFG.PVP_ENERGY_COST);
      await c.query(
        `UPDATE match_players
            SET state = 'JOINED', pvp_opt = $3, pvp_portfolio = 0, pvp_locked = 0, joined_at = now()
          WHERE match_id = $1 AND user_id = $2`,
        [matchId, me.id, CFG.PVP_INITIAL_OPT]
      );
      return {
        ok: true,
        message: `Joined · −${CFG.PVP_ENERGY_COST} Energy · ${CFG.PVP_INITIAL_OPT} PvP OPT`,
      };
    });
  });
}

export async function startMatch(matchId: number): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    return await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const m = rows[0];
      if (!m) fail("match not found");
      if (m.creator_id !== me.id) fail("only the creator can start the match");
      if (m.status !== "LOBBY") fail("this match already started");

      const { rows: joined } = await c.query(
        `SELECT count(*)::int AS n FROM match_players WHERE match_id = $1 AND state = 'JOINED'`,
        [matchId]
      );
      if (joined[0].n < 2) fail("At least two players must accept before starting");

      const endsAt = new Date(Date.now() + m.duration_min * 60_000);
      await c.query(
        `UPDATE matches SET status = 'ACTIVE', started_at = now(), ends_at = $2 WHERE id = $1`,
        [matchId, endsAt]
      );
      // Anyone who never responded is out; they keep their Energy.
      await c.query(
        `UPDATE match_players SET state = 'DECLINED' WHERE match_id = $1 AND state = 'INVITED'`,
        [matchId]
      );
      return { ok: true, message: `Match started · ${m.duration_min} minutes on the clock` };
    });
  });
}

/** Burn PvP Portfolio for PvP OPT — the isolated-economy version of §12 (§25). */
export async function pvpConvert(matchId: number, usdAmount: number): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    if (!(usdAmount > 0) || !Number.isFinite(usdAmount)) fail("invalid amount");
    return await tx(async (c) => {
      // FOR SHARE, not a bare read: the settler finalises under FOR UPDATE on this row, so an
      // unlocked check could pass and then convert into balances that were already ranked.
      const { rows: m } = await c.query(`SELECT status FROM matches WHERE id = $1 FOR SHARE`, [
        matchId,
      ]);
      if (m[0]?.status !== "ACTIVE") fail("this match is not running");

      const { rows } = await c.query(
        `SELECT pvp_portfolio, pvp_locked FROM match_players
          WHERE match_id = $1 AND user_id = $2 FOR UPDATE`,
        [matchId, me.id]
      );
      if (!rows[0]) fail("you are not in this match");
      const free = rows[0].pvp_portfolio - rows[0].pvp_locked;
      if (free < usdAmount) fail(`Only $${free.toFixed(0)} of your PvP Portfolio is free`);

      const gained = usdAmount * CFG.PORTFOLIO_TO_OPT_RATIO;
      await c.query(
        `UPDATE match_players SET pvp_portfolio = pvp_portfolio - $3, pvp_opt = pvp_opt + $4
          WHERE match_id = $1 AND user_id = $2`,
        [matchId, me.id, usdAmount, gained]
      );
      return { ok: true, message: `Burned $${usdAmount.toFixed(0)} → +${gained.toFixed(0)} PvP OPT` };
    });
  });
}

/** Lets the creator end early; the normal path is the settler noticing ends_at has passed. */
export async function endMatchNow(matchId: number): Promise<Res> {
  return guard(async () => {
    const me = await requireMe();
    const prices = await getPrices();
    return await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const m = rows[0];
      if (!m) fail("match not found");
      if (m.creator_id !== me.id) fail("only the creator can end the match");
      if (m.status !== "ACTIVE") fail("this match is not running");
      await finalizeMatchInTx(c, matchId, prices);
      return { ok: true, message: "Match finished" };
    });
  });
}
