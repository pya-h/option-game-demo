"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown, Layers, Star, Target, Trophy, Wallet } from "lucide-react";
import { useState } from "react";
import { num, usd } from "@/lib/fmt";
import { levelFor, levelProgress } from "@/lib/levels";

export type BoardRow = {
  id: number;
  username: string;
  portfolio: number;
  xp: number;
  cards: number;
  wins: number;
  resolved: number;
  trophies: number;
};

export type MyStanding = {
  id: number;
  username: string;
  portfolio: number;
  xp: number;
  portfolio_rank: number;
  xp_rank: number;
  players: number;
};

type Board = "portfolio" | "xp";

const MEDAL = ["🥇", "🥈", "🥉"];

/**
 * The two leaderboards.
 *
 * Structured around the tension the game is built on: Portfolio is the number you spend *and*
 * the number you're ranked on, while XP only ever accumulates. Showing them side by side is
 * the point — a player near the top of one and nowhere on the other has made a real choice.
 *
 * Rows animate by layout rather than swapping, so a player climbing between polls is seen to
 * climb. Rank is the layout key, so the movement is the rank change and nothing else.
 */
export default function Leaderboards({
  byPortfolio,
  byXp,
  meId,
  mine,
}: {
  byPortfolio: BoardRow[];
  byXp: BoardRow[];
  meId: number | null;
  mine: MyStanding | null;
}) {
  const [board, setBoard] = useState<Board>("portfolio");
  const rows = board === "portfolio" ? byPortfolio : byXp;
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);

  const myRank = mine ? (board === "portfolio" ? mine.portfolio_rank : mine.xp_rank) : null;
  const inTop = rows.some((r) => r.id === meId);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-semibold">🏆 Rankings</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mute">
            Two kinds of success, and they pull against each other. Portfolio measures wealth
            you&apos;ve built <em>and kept</em> — every purchase drops you. XP only accumulates,
            and a correct option earns it whether you exercise or not.
          </p>
        </div>
        <div className="ml-auto flex rounded-xl border border-edge p-0.5">
          {(
            [
              ["portfolio", "Portfolio", Wallet],
              ["xp", "Level & XP", Star],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setBoard(k)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                board === k
                  ? k === "portfolio"
                    ? "bg-mint/20 text-mint"
                    : "bg-sell/20 text-sell"
                  : "text-mute hover:text-slate-200"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* podium */}
      {top.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          {/* Second, first, third — the winner sits in the middle and stands tallest. */}
          {[top[1], top[0], top[2]].map((r, i) =>
            r ? (
              <Podium
                key={r.id}
                row={r}
                place={i === 1 ? 1 : i === 0 ? 2 : 3}
                board={board}
                me={r.id === meId}
              />
            ) : (
              <div key={`gap-${i}`} className="hidden sm:block" />
            )
          )}
        </section>
      )}

      {/* the rest */}
      <section className="panel overflow-hidden">
        <h2 className="flex items-center gap-2 border-b border-edge px-4 py-3 text-sm font-semibold">
          {board === "portfolio" ? (
            <Wallet size={15} className="text-mint" />
          ) : (
            <Star size={15} className="text-sell" />
          )}
          {board === "portfolio" ? "Portfolio ranking" : "Level ranking"}
          <span className="ml-auto text-[11px] font-normal text-mute">hover a row for detail</span>
        </h2>

        <ol>
          <AnimatePresence initial={false}>
            {rest.map((r, i) => (
              <Row key={r.id} row={r} rank={i + 4} board={board} me={r.id === meId} />
            ))}
          </AnimatePresence>
          {!rows.length && (
            <li className="px-4 py-10 text-center text-sm text-mute">No players yet.</li>
          )}
        </ol>

        {/* Pinned own standing, when it isn't already on the board above. */}
        {mine && !inTop && (
          <div className="border-t border-buy/40 bg-buy/10 px-4 py-3">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-mute">
              your standing
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="tabnum w-10 shrink-0 text-center font-mono text-xs text-buy">
                #{myRank}
              </span>
              <span className="flex-1 truncate font-semibold text-buy">
                {mine.username}
                <span className="ml-1.5 text-[10px] text-mute">you</span>
              </span>
              <span className="tabnum font-mono font-semibold">
                {board === "portfolio"
                  ? usd(mine.portfolio, 0)
                  : `L${levelFor(mine.xp)} · ${num(mine.xp, 0)} XP`}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-mute">
              of {mine.players} players · keep going to reach the board
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Podium({
  row,
  place,
  board,
  me,
}: {
  row: BoardRow;
  place: number;
  board: Board;
  me: boolean;
}) {
  const p = levelProgress(row.xp);
  const tone =
    place === 1
      ? { ring: "border-gold/70", glow: "0 0 50px -14px #fbbf24", text: "text-gold" }
      : place === 2
        ? { ring: "border-slate-400/60", glow: "0 0 40px -18px #cbd5e1", text: "text-slate-300" }
        : { ring: "border-amber-700/60", glow: "0 0 40px -18px #b45309", text: "text-amber-600" };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 22, delay: place * 0.06 }}
      whileHover={{ y: -5 }}
      // No `foil` here: it clips to its own bounds, which ate the crown above the winner.
      className={`panel relative flex flex-col items-center border p-4 text-center ${tone.ring} ${
        place === 1 ? "sm:-mt-3 sm:pb-5" : ""
      } ${me ? "ring-1 ring-buy/50" : ""}`}
      style={{ boxShadow: tone.glow }}
    >
      {/* In flow rather than absolutely positioned, so nothing has to overflow to show it. */}
      {place === 1 && (
        <motion.div
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 2.4, repeat: Infinity }}
          className="-mt-1 text-gold"
        >
          <Crown size={18} />
        </motion.div>
      )}
      <div className="text-3xl leading-none">{MEDAL[place - 1]}</div>
      <div className={`mt-1.5 max-w-full truncate font-semibold ${me ? "text-buy" : ""}`}>
        {row.username}
        {me && <span className="ml-1 text-[10px] text-mute">you</span>}
      </div>
      <div className={`tabnum mt-1 font-mono text-lg font-bold ${tone.text}`}>
        {board === "portfolio" ? usd(row.portfolio, 0) : `${num(row.xp, 0)} XP`}
      </div>
      <div className="mt-0.5 text-[11px] text-mute">
        {board === "portfolio" ? `Level ${p.level}` : usd(row.portfolio, 0)}
      </div>
      <Meta row={row} className="mt-2.5 justify-center" />
    </motion.div>
  );
}

function Row({
  row,
  rank,
  board,
  me,
}: {
  row: BoardRow;
  rank: number;
  board: Board;
  me: boolean;
}) {
  const p = levelProgress(row.xp);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={`group border-b border-edge/40 px-4 py-2.5 text-sm transition last:border-0 hover:bg-white/[0.04] ${
        me ? "bg-buy/10" : rank % 2 ? "bg-white/[0.015]" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="tabnum w-8 shrink-0 text-center font-mono text-xs text-mute">
          #{rank}
        </span>
        <span className={`min-w-0 flex-1 truncate ${me ? "font-semibold text-buy" : "text-slate-200"}`}>
          {row.username}
          {me && <span className="ml-1.5 text-[10px] text-mute">you</span>}
        </span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-mute">
          L{p.level}
        </span>
        <span
          className="tabnum font-mono font-semibold"
          style={{ color: board === "portfolio" ? "#34d399" : "#f472b6" }}
        >
          {board === "portfolio" ? usd(row.portfolio, 0) : `${num(row.xp, 0)} XP`}
        </span>
      </div>

      {/* Detail on hover: the board shows one number, and the interesting question is always
          how it was earned. Collapsed by grid rows so the list stays scannable. */}
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 group-hover:grid-rows-[1fr]">
        <div className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-11 pt-2">
            <Meta row={row} />
            <div className="ml-auto flex min-w-[120px] items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-edge">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-violet-500"
                  style={{ width: `${p.pct}%` }}
                />
              </div>
              <span className="tabnum font-mono text-[10px] text-mute">L{p.level + 1}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function Meta({ row, className = "" }: { row: BoardRow; className?: string }) {
  const rate = row.resolved ? Math.round((row.wins / row.resolved) * 100) : null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute ${className}`}>
      <span className="inline-flex items-center gap-1">
        <Layers size={11} /> {num(row.cards, 0)} cards
      </span>
      <span className="inline-flex items-center gap-1">
        <Target size={11} className={rate !== null && rate >= 50 ? "text-mint" : ""} />
        {rate === null ? "—" : `${rate}% won`}
      </span>
      {row.trophies > 0 && (
        <span className="inline-flex items-center gap-1 text-gold">
          <Trophy size={11} /> {row.trophies}
        </span>
      )}
    </div>
  );
}
