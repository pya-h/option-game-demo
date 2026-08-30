import type { PoolClient } from "pg";
import { CFG, type AssetSymbol } from "./config";
import { tx } from "./db";
import { exerciseCost, exercisePayout, sellLoss } from "./options";
import { runMatchmakingInTx } from "./game/matchmaking";
import { getPrices } from "./prices";

/**
 * Advisory lock guarding every settlement pass. Anything that settles cards or finalises a
 * match must hold it, because the settler locks card rows before match rows and a caller that
 * did the reverse could deadlock against it.
 */
export const SETTLE_LOCK_KEY = 918273;
const LOCK_KEY = SETTLE_LOCK_KEY;

type DueCard = {
  id: number;
  match_id: number | null;
  owner_id: number;
  kind: "BUY" | "SELL";
  asset: AssetSymbol;
  strike: number;
  amount: number;
  collateral: number;
};

async function logEvent(
  c: PoolClient,
  cardId: number,
  type: string,
  opts: { actor?: number | null; opt?: number; portfolio?: number; note?: string } = {}
) {
  await c.query(
    `INSERT INTO card_events (card_id, type, actor_id, opt_delta, portfolio_delta, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [cardId, type, opts.actor ?? null, opts.opt ?? 0, opts.portfolio ?? 0, opts.note ?? null]
  );
}

/** Settles one expired card. Balances go to users (global) or match_players (PvP). */
export async function settleCard(c: PoolClient, card: DueCard, spot: number) {
  const isPvp = card.match_id !== null;

  if (card.kind === "BUY") {
    const won = spot > card.strike;
    await c.query(
      `UPDATE cards SET status = $2, settle_price = $3, settled_at = now(), for_sale = FALSE
       WHERE id = $1`,
      [card.id, won ? "WON" : "LOST", spot]
    );
    // XP is global-only progression; PvP grants XP once, at match settlement (§29).
    if (won && !isPvp) {
      await c.query(`UPDATE users SET xp = xp + $2 WHERE id = $1`, [
        card.owner_id,
        CFG.SUCCESSFUL_OPTION_XP,
      ]);
    }
    await logEvent(c, card.id, won ? "WON" : "LOST", {
      note: `settled at ${spot}` + (won && !isPvp ? ` · +${CFG.SUCCESSFUL_OPTION_XP} XP` : ""),
    });
    return;
  }

  // SELL: the writer carried the obligation. Loss is capped at the locked collateral.
  const loss = sellLoss(card.strike, card.amount, spot, card.collateral);
  const survived = loss <= 0;

  if (isPvp) {
    await c.query(
      `UPDATE match_players
         SET pvp_portfolio = pvp_portfolio - $3, pvp_locked = pvp_locked - $4
       WHERE match_id = $1 AND user_id = $2`,
      [card.match_id, card.owner_id, loss, card.collateral]
    );
  } else {
    await c.query(
      `UPDATE users
         SET portfolio = portfolio - $2, locked = locked - $3, xp = xp + $4
       WHERE id = $1`,
      [card.owner_id, loss, card.collateral, survived ? CFG.SUCCESSFUL_OPTION_XP : 0]
    );
  }

  await c.query(
    `UPDATE cards SET status = 'SETTLED', settle_price = $2, settled_at = now(), for_sale = FALSE
     WHERE id = $1`,
    [card.id, spot]
  );
  await logEvent(c, card.id, survived ? "OBLIGATION_EXPIRED" : "OBLIGATION_PAID", {
    portfolio: -loss,
    note: survived
      ? `settled at ${spot} · collateral released` +
        (isPvp ? "" : ` · +${CFG.SUCCESSFUL_OPTION_XP} XP`)
      : `settled at ${spot} · paid ${loss.toFixed(2)}`,
  });
}

/**
 * Resolves every expired card and finalises every match past its end time.
 * Runs lazily at the top of the read endpoints — no cron, no worker. The advisory
 * lock means concurrent polls can't double-settle; losers simply skip this round.
 */
export async function settleDue() {
  const prices = await getPrices();
  if (!Object.keys(prices).length) return;

  await tx(async (c) => {
    const { rows: got } = await c.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [LOCK_KEY]);
    if (!got[0]?.ok) return;

    const { rows: due } = await c.query<DueCard>(
      `SELECT id, match_id, owner_id, kind, asset, strike, amount, collateral
         FROM cards WHERE status = 'ACTIVE' AND expires_at <= now()
         ORDER BY id FOR UPDATE`
    );
    for (const card of due) {
      const spot = prices[card.asset]?.price;
      if (!spot) continue; // no price for this asset right now; retry next poll
      await settleCard(c, card, spot);
    }

    const { rows: ended } = await c.query<{ id: number }>(
      `SELECT id FROM matches WHERE status = 'ACTIVE' AND ends_at <= now() FOR UPDATE`
    );
    for (const m of ended) await finalizeMatchInTx(c, m.id, prices);

    // Forming matches belongs here for the same reason settling does: it needs to happen
    // regularly, exactly once at a time, and without a worker process to run it.
    await runMatchmakingInTx(c);
  });
}

/**
 * Ends a match: settles anything still open, auto-exercises affordable winning cards
 * (the player can no longer click), releases locks, ranks by final PvP Portfolio and
 * pays the winner's controlled global reward (§27).
 */
export async function finalizeMatchInTx(
  c: PoolClient,
  matchId: number,
  prices: Awaited<ReturnType<typeof getPrices>>
) {
  const { rows: open } = await c.query<DueCard>(
    `SELECT id, match_id, owner_id, kind, asset, strike, amount, collateral
       FROM cards WHERE match_id = $1 AND status = 'ACTIVE' ORDER BY id FOR UPDATE`,
    [matchId]
  );
  for (const card of open) {
    const spot = prices[card.asset]?.price;
    if (spot) {
      await settleCard(c, card, spot);
      continue;
    }
    // No price for this asset right now. Leaving the card ACTIVE would strand it in a match
    // that is about to be ranked and closed, so close it out unresolved instead: the writer
    // gets their collateral back and nobody is charged for our missing data.
    await c.query(
      `UPDATE cards SET status = 'SETTLED', settled_at = now(), for_sale = FALSE WHERE id = $1`,
      [card.id]
    );
    if (card.kind === "SELL" && card.collateral > 0) {
      await c.query(
        `UPDATE match_players SET pvp_locked = pvp_locked - $3
          WHERE match_id = $1 AND user_id = $2`,
        [card.match_id, card.owner_id, card.collateral]
      );
    }
    await logEvent(c, card.id, "VOIDED", {
      note: "match ended with no price available · closed without settlement",
    });
  }

  // Auto-exercise winners the owner never got to click, when they can afford it.
  const { rows: won } = await c.query<{
    id: number;
    owner_id: number;
    strike: number;
    amount: number;
    settle_price: number;
  }>(
    `SELECT id, owner_id, strike, amount, settle_price
       FROM cards WHERE match_id = $1 AND status = 'WON' ORDER BY id FOR UPDATE`,
    [matchId]
  );
  for (const card of won) {
    const cost = exerciseCost(card.strike, card.amount);
    const payout = exercisePayout(card.strike, card.amount, card.settle_price);
    const { rows: p } = await c.query<{ pvp_opt: number }>(
      `SELECT pvp_opt FROM match_players WHERE match_id = $1 AND user_id = $2 FOR UPDATE`,
      [matchId, card.owner_id]
    );
    if (!p[0] || p[0].pvp_opt < cost) continue;
    await c.query(
      `UPDATE match_players SET pvp_opt = pvp_opt - $3, pvp_portfolio = pvp_portfolio + $4
        WHERE match_id = $1 AND user_id = $2`,
      [matchId, card.owner_id, cost, payout]
    );
    await c.query(`UPDATE cards SET status = 'EXERCISED' WHERE id = $1`, [card.id]);
    await logEvent(c, card.id, "EXERCISED", {
      actor: card.owner_id,
      opt: -cost,
      portfolio: payout,
      note: "auto-exercised at match end",
    });
  }

  const { rows: standings } = await c.query<{ user_id: number; pvp_portfolio: number }>(
    `SELECT user_id, pvp_portfolio FROM match_players
      WHERE match_id = $1 AND state = 'JOINED'
      ORDER BY pvp_portfolio DESC, user_id ASC`,
    [matchId]
  );
  for (let i = 0; i < standings.length; i++) {
    await c.query(
      `UPDATE match_players SET final_rank = $3 WHERE match_id = $1 AND user_id = $2`,
      [matchId, standings[i].user_id, i + 1]
    );
  }

  // Only the temporary balances decide the winner; the global reward is fixed and small (§27).
  if (standings.length) {
    await c.query(`UPDATE users SET xp = xp + $2, opt = opt + $3, portfolio = portfolio + $4 WHERE id = $1`, [
      standings[0].user_id,
      CFG.PVP_WIN_XP,
      CFG.PVP_WIN_OPT_REWARD,
      CFG.PVP_WIN_PORTFOLIO_REWARD,
    ]);
  }

  await c.query(`UPDATE matches SET status = 'FINISHED' WHERE id = $1`, [matchId]);
}
