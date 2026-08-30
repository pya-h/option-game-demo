import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { accrue } from "@/lib/energy";
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
    if (a.energy !== u.energy) {
      await c.query(`UPDATE users SET energy = $2, energy_updated_at = $3 WHERE id = $1`, [
        uid,
        a.energy,
        a.updatedAt,
      ]);
    }

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

    const body: StateDTO = {
      me: {
        id: u.id,
        username: u.username,
        opt: u.opt,
        portfolio: u.portfolio,
        locked: u.locked,
        spendable: u.portfolio - u.locked,
        xp: u.xp,
        energy: a.energy,
        energy_capacity: u.energy_capacity,
        nextEnergyMs: a.nextInMs,
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
      cfg: publicCfg(),
    };
    return NextResponse.json(body);
  } finally {
    c.release();
  }
}
