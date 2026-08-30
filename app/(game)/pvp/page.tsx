import { q } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import PvpLobby from "@/components/PvpLobby";

export const dynamic = "force-dynamic";

export type LobbyRow = {
  id: number;
  name: string;
  mode: "DUEL" | "GROUP";
  status: "LOBBY" | "ACTIVE" | "FINISHED";
  duration_min: number;
  ends_at: string | null;
  creator: string;
  creator_id: number;
  my_state: "INVITED" | "JOINED" | "DECLINED";
  my_rank: number | null;
  roster: string;
  joined: number;
};

export default async function PvpPage() {
  const uid = await currentUserId();

  const rows = await q<LobbyRow>(
    `SELECT m.id, m.name, m.mode, m.status, m.duration_min, m.ends_at,
            u.username AS creator, m.creator_id,
            mine.state AS my_state, mine.final_rank AS my_rank,
            (SELECT string_agg(pu.username, ', ' ORDER BY pu.username)
               FROM match_players p JOIN users pu ON pu.id = p.user_id
              WHERE p.match_id = m.id AND p.state <> 'DECLINED') AS roster,
            (SELECT count(*)::int FROM match_players p
              WHERE p.match_id = m.id AND p.state = 'JOINED') AS joined
       FROM matches m
       JOIN users u ON u.id = m.creator_id
       JOIN match_players mine ON mine.match_id = m.id AND mine.user_id = $1
      ORDER BY (m.status = 'ACTIVE') DESC, (m.status = 'LOBBY') DESC, m.id DESC
      LIMIT 40`,
    [uid]
  );

  return <PvpLobby rows={rows} meId={uid!} />;
}
