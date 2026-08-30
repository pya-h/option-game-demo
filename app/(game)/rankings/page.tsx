import { Trophy, Wallet } from "lucide-react";
import { q } from "@/lib/db";
import { num, usd } from "@/lib/fmt";
import { currentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

type Row = { id: number; username: string; portfolio: number; xp: number };

const MEDALS = ["🥇", "🥈", "🥉"];

function Board({
  title,
  icon,
  rows,
  meId,
  render,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Row[];
  meId: number | null;
  render: (r: Row) => string;
  accent: string;
}) {
  return (
    <section className="panel panel-hi overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-edge px-4 py-3 font-semibold">
        {icon}
        {title}
      </h2>
      <ol>
        {rows.map((r, i) => {
          const me = r.id === meId;
          return (
            <li
              key={r.id}
              className={`flex items-center gap-3 border-b border-edge/40 px-4 py-2.5 text-sm last:border-0 ${
                me ? "bg-buy/10" : i % 2 ? "bg-white/[0.015]" : ""
              }`}
            >
              <span className="w-8 shrink-0 text-center font-mono text-xs text-mute">
                {MEDALS[i] ?? `#${i + 1}`}
              </span>
              <span className={`flex-1 truncate ${me ? "font-semibold text-buy" : "text-slate-200"}`}>
                {r.username}
                {me && <span className="ml-1.5 text-[10px] text-mute">you</span>}
              </span>
              <span className="tabnum font-mono font-semibold" style={{ color: accent }}>
                {render(r)}
              </span>
            </li>
          );
        })}
        {!rows.length && <li className="px-4 py-10 text-center text-sm text-mute">No players yet.</li>}
      </ol>
    </section>
  );
}

export default async function RankingsPage() {
  const meId = await currentUserId();
  const byPortfolio = await q<Row>(
    `SELECT id, username, portfolio, xp FROM users ORDER BY portfolio DESC, xp DESC LIMIT 25`
  );
  const byXp = await q<Row>(
    `SELECT id, username, portfolio, xp FROM users ORDER BY xp DESC, portfolio DESC LIMIT 25`
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">🏆 Rankings</h1>
        <p className="mt-1 text-xs text-mute">
          Two different kinds of success. Portfolio measures wealth you&apos;ve built and kept —
          spending it drops you. XP only accumulates, and a correct option earns it whether you
          exercise or not.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Board
          title="Portfolio Ranking"
          icon={<Wallet size={16} className="text-mint" />}
          rows={byPortfolio}
          meId={meId}
          accent="#34d399"
          render={(r) => usd(r.portfolio, 0)}
        />
        <Board
          title="XP Ranking"
          icon={<Trophy size={16} className="text-sell" />}
          rows={byXp}
          meId={meId}
          accent="#f472b6"
          render={(r) => `${num(r.xp, 0)} XP`}
        />
      </div>
    </div>
  );
}
