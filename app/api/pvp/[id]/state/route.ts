import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getPrices } from "@/lib/prices";
import { publicCfg } from "@/lib/public-config";
import { currentUserId } from "@/lib/session";
import { settleDue } from "@/lib/settle";
import type { MatchDTO, PvpStateDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: "auth" }, { status: 401 });

  const matchId = parseInt((await ctx.params).id, 10);
  if (!Number.isInteger(matchId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  // Also finalises the match the moment its clock runs out.
  await settleDue();

  const [match] = await q<MatchDTO>(
    `SELECT m.*, u.username AS creator FROM matches m JOIN users u ON u.id = m.creator_id
      WHERE m.id = $1`,
    [matchId]
  );
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });

  const players = await q(
    `SELECT mp.user_id, u.username, mp.state, mp.pvp_opt, mp.pvp_portfolio, mp.pvp_locked, mp.final_rank
       FROM match_players mp JOIN users u ON u.id = mp.user_id
      WHERE mp.match_id = $1
      ORDER BY mp.final_rank NULLS LAST, mp.pvp_portfolio DESC, u.username`,
    [matchId]
  );

  // Cards are scoped to this match and nothing else — global cards can never appear (§23).
  const cards = await q(
    `SELECT c.*, o.username AS owner, cr.username AS creator
       FROM cards c JOIN users o ON o.id = c.owner_id JOIN users cr ON cr.id = c.creator_id
      WHERE c.match_id = $1 ORDER BY c.id DESC LIMIT 200`,
    [matchId]
  );

  const prices = await getPrices();
  const body: PvpStateDTO = {
    match: { ...match, players: players as MatchDTO["players"] },
    cards: cards as PvpStateDTO["cards"],
    prices: Object.values(prices).map((p) => ({
      asset: p.asset,
      price: p.price,
      prev_price: p.prev_price,
    })),
    meId: uid,
    cfg: publicCfg(),
  };
  return NextResponse.json(body);
}
