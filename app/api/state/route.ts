import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { accrue, persistAccrual } from "@/lib/energy";
import { heartbeat, queueStatusFor } from "@/lib/game/matchmaking";
import { levelProgress, optPerDrip } from "@/lib/levels";
import { getPrices } from "@/lib/prices";
import { publicCfg } from "@/lib/public-config";
import { currentUserId } from "@/lib/session";
import { settleDue } from "@/lib/settle";
import type { StateDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: "auth" }, { status: 401 });

  // Lazy resolution: every poll advances the world before reading it.
  await settleDue();

  const prices = await getPrices();

  const c = await pool.connect();
  try {
    const { rows: urows } = await c.query(`SELECT * FROM users WHERE id = $1`, [uid]);
    const u = urows[0];
    if (!u) return NextResponse.json({ error: "auth" }, { status: 401 });

    const a = accrue(u);
    if (a.energy !== Number(u.energy) || a.dripped) await persistAccrual(c, uid, a);

    // A level-up is owed, not fired. XP arrives whenever a poll happens to settle a card, so
    // it routinely lands with the player looking elsewhere or logged out entirely; the
    // celebration waits in level_seen until they are actually here to see it. The payload
    // reports it and the client acknowledges once it has been shown.
    const xp = Number(u.xp);
    const progress = levelProgress(xp);
    const pending =
      progress.level > Number(u.level_seen)
        ? { from: Number(u.level_seen), to: progress.level }
        : null;

    const { rows: ranks } = await c.query(
      `SELECT
         (SELECT count(*) FROM users x WHERE x.portfolio > u.portfolio) + 1 AS prank,
         (SELECT count(*) FROM users x WHERE x.xp > u.xp) + 1 AS xrank,
         (SELECT count(*) FROM users) AS players
       FROM users u WHERE u.id = $1`,
      [uid]
    );

    const { rows: cards } = await c.query(
      `SELECT c.*, o.username AS owner, cr.username AS creator
         FROM cards c
         JOIN users o  ON o.id  = c.owner_id
         JOIN users cr ON cr.id = c.creator_id
        WHERE c.match_id IS NULL
          AND (c.status IN ('ACTIVE','WON') OR c.owner_id = $1)
        ORDER BY c.id DESC LIMIT 200`,
      [uid]
    );

    const { rows: inv } = await c.query(
      `SELECT count(*)::int AS n FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
        WHERE mp.user_id = $1 AND mp.state = 'INVITED' AND m.status = 'LOBBY'`,
      [uid]
    );

    // Polling is what keeps a queued player's seat alive; stop polling and they age out.
    await heartbeat(c, uid);
    const queue = await queueStatusFor(c, uid);

    // Matchmaking joins a player to a live match without them clicking anything, so the client
    // needs to be told where to go.
    const { rows: liveMatch } = await c.query<{ id: number }>(
      `SELECT m.id FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
        WHERE mp.user_id = $1 AND mp.state = 'JOINED' AND m.status = 'ACTIVE'
        ORDER BY m.started_at DESC LIMIT 1`,
      [uid]
    );

    const body: StateDTO = {
      me: {
        id: u.id,
        username: u.username,
        portfolio: u.portfolio,
        locked: u.locked,
        spendable: u.portfolio - u.locked,
        xp,
        level: progress.level,
        levelInto: progress.into,
        levelSpan: progress.span,
        levelPct: progress.pct,
        pendingLevelUp: pending,
        opt: a.opt,
        energy: a.energy,
        energy_capacity: a.capacity,
        nextEnergyMs: a.energyNextInMs,
        nextOptMs: a.optNextInMs,
        optPerDrip: optPerDrip(progress.level, Number(u.drip_upgrades)),
        dripActive: a.dripActive,
        energyUpgrades: Number(u.energy_upgrades),
        dripUpgrades: Number(u.drip_upgrades),
        portfolioRank: ranks[0].prank,
        xpRank: ranks[0].xrank,
        players: ranks[0].players,
      },
      prices: Object.values(prices).map((p) => ({
        asset: p.asset,
        price: p.price,
        prev_price: p.prev_price,
      })),
      cards: cards as StateDTO["cards"],
      pendingInvites: inv[0].n,
      queue,
      liveMatchId: liveMatch[0]?.id ?? null,
      cfg: publicCfg(),
    };
    return NextResponse.json(body);
  } finally {
    c.release();
  }
}
