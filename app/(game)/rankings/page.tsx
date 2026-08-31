import { q } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import Leaderboards, { type BoardRow, type MyStanding } from "@/components/Leaderboards";

export const dynamic = "force-dynamic";

/**
 * The detail a row reveals on hover, computed in SQL rather than fetched per row. The boards
 * are 25 rows and every subquery is indexed, so doing it here costs one round trip instead of
 * twenty-five.
 */
const BOARD = `
  SELECT u.id, u.username, u.portfolio, u.xp,
         (SELECT count(*)::int FROM cards c
           WHERE c.owner_id = u.id AND c.match_id IS NULL) AS cards,
         (SELECT count(*)::int FROM cards c
           WHERE c.owner_id = u.id AND c.match_id IS NULL
             AND c.status IN ('WON','EXERCISED','LAPSED')) AS wins,
         (SELECT count(*)::int FROM cards c
           WHERE c.owner_id = u.id AND c.match_id IS NULL
             AND c.status <> 'ACTIVE') AS resolved,
         (SELECT count(*)::int FROM match_players mp
           WHERE mp.user_id = u.id AND mp.final_rank = 1) AS trophies
    FROM users u`;

export default async function RankingsPage() {
  const meId = await currentUserId();

  const [byPortfolio, byXp] = await Promise.all([
    q<BoardRow>(`${BOARD} ORDER BY u.portfolio DESC, u.xp DESC LIMIT 25`),
    q<BoardRow>(`${BOARD} ORDER BY u.xp DESC, u.portfolio DESC LIMIT 25`),
  ]);

  // A player outside the top 25 is still owed their own standing — being simply absent from
  // the page that ranks you reads as a bug rather than as a ranking.
  let mine: MyStanding | null = null;
  if (meId) {
    const [row] = await q<MyStanding>(
      `SELECT
         (SELECT count(*)::int FROM users x WHERE x.portfolio > u.portfolio) + 1 AS portfolio_rank,
         (SELECT count(*)::int FROM users x WHERE x.xp > u.xp) + 1 AS xp_rank,
         (SELECT count(*)::int FROM users) AS players,
         u.id, u.username, u.portfolio, u.xp
       FROM users u WHERE u.id = $1`,
      [meId]
    );
    mine = row ?? null;
  }

  return <Leaderboards byPortfolio={byPortfolio} byXp={byXp} meId={meId} mine={mine} />;
}
