"use client";

import { motion } from "framer-motion";
import { Coins, Flag, Lock, Play, Recycle, Swords, Trophy, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { endMatchNow, pvpConvert, startMatch } from "@/app/actions/pvp";
import { MATCH_EXPIRY_MARGIN_SECONDS } from "@/lib/config";
import { clock, num, usd } from "@/lib/fmt";
import type { PvpStateDTO } from "@/lib/types";
import CardGrid from "./CardGrid";
import { useNow } from "./Countdown";
import CreateOptionPanel from "./CreateOptionPanel";
import { useGame } from "./GameProvider";

export default function MatchRoom({ matchId }: { matchId: number }) {
  const { toast, refresh: refreshGlobal } = useGame();
  const [s, setS] = useState<PvpStateDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [burn, setBurn] = useState(50);
  const now = useNow();

  const load = useCallback(async () => {
    const r = await fetch(`/api/pvp/${matchId}/state`, { cache: "no-store" });
    if (r.ok) setS(await r.json());
  }, [matchId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    try {
      const res = await fn();
      toast(res.message ?? (res.ok ? "Done" : "Failed"), res.ok ? "ok" : "bad");
      await load();
      await refreshGlobal();
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <div className="panel h-72 animate-pulse opacity-50" />;

  const { match, cards, prices, meId, cfg } = s;
  const me = match.players.find((p) => p.user_id === meId);
  const joined = match.players.filter((p) => p.state === "JOINED");
  const iAmCreator = match.creator_id === meId;
  const msLeft = match.ends_at ? new Date(match.ends_at).getTime() - now : 0;
  const secsLeft = Math.max(0, msLeft / 1000);
  const live = match.status === "ACTIVE" && msLeft > 0;
  const inMatch = me?.state === "JOINED";
  const myFree = me ? me.pvp_portfolio - me.pvp_locked : 0;

  return (
    <div className="space-y-4">
      {/* header */}
      <header className="panel panel-hi flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {match.mode === "DUEL" ? (
              <Swords size={16} className="text-sell" />
            ) : (
              <Users size={16} className="text-buy" />
            )}
            <h1 className="truncate text-lg font-semibold">{match.name}</h1>
          </div>
          <p className="text-[11px] text-mute">
            by {match.creator} · {match.duration_min} min · isolated economy
          </p>
        </div>

        <div className="ml-auto text-right">
          {match.status === "LOBBY" && (
            <span className="rounded-full bg-gold/15 px-3 py-1 text-xs text-gold">
              Waiting for players
            </span>
          )}
          {match.status === "ACTIVE" && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-mute">Time left</div>
              <motion.div
                animate={secsLeft < 60 ? { scale: [1, 1.06, 1] } : {}}
                transition={{ duration: 1, repeat: Infinity }}
                className={`tabnum font-mono text-2xl font-bold ${
                  secsLeft < 60 ? "text-danger" : "text-mint"
                }`}
              >
                {clock(Math.max(0, msLeft))}
              </motion.div>
            </div>
          )}
          {match.status === "FINISHED" && (
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-mute">Finished</span>
          )}
        </div>
      </header>

      {/* standings */}
      <section className="panel p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          {match.status === "FINISHED" ? (
            <>
              <Trophy size={16} className="text-gold" /> Final results
            </>
          ) : (
            <>
              <Users size={16} className="text-buy" /> Players
            </>
          )}
        </h2>
        <ol className="space-y-1.5">
          {match.players.map((p, i) => {
            const isMe = p.user_id === meId;
            const rank = p.final_rank ?? (p.state === "JOINED" ? i + 1 : null);
            const podium = match.status === "FINISHED" && p.final_rank === 1;
            return (
              <motion.li
                key={p.user_id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${
                  podium
                    ? "border-gold/60 bg-gold/10"
                    : isMe
                      ? "border-buy/40 bg-buy/5"
                      : "border-edge bg-black/20"
                }`}
              >
                <span className="w-6 text-center font-mono text-xs text-mute">
                  {p.state === "JOINED" ? (podium ? "🥇" : `#${rank}`) : "–"}
                </span>
                <span className={`min-w-0 flex-1 truncate ${isMe ? "font-semibold text-buy" : ""}`}>
                  {p.username}
                  {isMe && <span className="ml-1.5 text-[10px] text-mute">you</span>}
                </span>
                {p.state === "JOINED" ? (
                  <>
                    <span className="tabnum inline-flex items-center gap-1 font-mono text-xs text-buy">
                      <Coins size={12} /> {num(p.pvp_opt, 0)}
                    </span>
                    <span className="tabnum inline-flex items-center gap-1 font-mono text-sm font-semibold text-mint">
                      <Wallet size={12} /> {usd(p.pvp_portfolio, 0)}
                    </span>
                    {p.pvp_locked > 0 && (
                      <span className="tabnum inline-flex items-center gap-1 font-mono text-[11px] text-gold">
                        <Lock size={10} /> {usd(p.pvp_locked, 0)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-mute">
                    {p.state === "INVITED" ? "invited…" : "declined"}
                  </span>
                )}
              </motion.li>
            );
          })}
        </ol>

        {match.status === "LOBBY" && iAmCreator && (
          <button
            className="btn btn-primary mt-3 w-full"
            disabled={busy || joined.length < 2}
            onClick={() => act(() => startMatch(matchId))}
          >
            <Play size={14} className="mr-1 inline" />
            {joined.length < 2 ? "Need at least 2 players to accept" : `Start · ${match.duration_min} min`}
          </button>
        )}
        {match.status === "LOBBY" && !iAmCreator && (
          <p className="mt-3 text-center text-xs text-mute">
            {inMatch ? "You're in. Waiting for the creator to start." : "Accept the invite from the PvP page."}
          </p>
        )}
        {match.status === "FINISHED" && (
          <p className="mt-3 rounded-xl border border-edge bg-black/25 px-3 py-2.5 text-center text-[11px] leading-relaxed text-mute">
            PvP balances ended with the match. The winner takes a fixed global reward —{" "}
            <span className="text-sell">+{cfg.pvpWinXp} XP</span>,{" "}
            <span className="text-buy">+{cfg.pvpWinOpt} OPT</span>,{" "}
            <span className="text-mint">+{usd(cfg.pvpWinPortfolio, 0)} Portfolio</span> — so a big
            match can&apos;t distort the main economy.
          </p>
        )}
      </section>

      {live && inMatch ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="order-2 space-y-4 lg:order-1">
            <section className="panel p-4">
              <h2 className="mb-3 font-semibold">Match cards</h2>
              <p className="mb-3 text-[11px] text-mute">
                These cards exist only inside this match and can only be traded with the players in
                it. No Energy is charged here — PvP OPT is your only limit.
              </p>
              <CardGrid
                cards={cards}
                prices={prices}
                meId={meId}
                spendable={myFree}
                optBalance={me!.pvp_opt}
              />
            </section>
          </div>

          <div className="order-1 space-y-4 lg:order-2">
            <CreateOptionPanel
              prices={prices}
              optBalance={me!.pvp_opt}
              spendable={myFree}
              matchId={matchId}
              // Same margin the server enforces, so the picker never offers an expiry that
              // createCard would then refuse.
              maxSeconds={Math.max(0, secsLeft - MATCH_EXPIRY_MARGIN_SECONDS)}
              premiumOptPerDollar={cfg.premiumOptPerDollar}
              onCreated={load}
            />

            <section className="panel p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Recycle size={15} className="text-mint" /> PvP Portfolio → PvP OPT
              </h3>
              <p className="mb-3 text-[11px] text-mute">
                Out of OPT? Burn match Portfolio at {cfg.portfolioToOptRatio}× — it costs you the
                exact number you&apos;re ranked on.
              </p>
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={burn}
                  onChange={(e) => setBurn(Math.max(0, Number(e.target.value) || 0))}
                  className="tabnum w-full rounded-lg border border-edge bg-black/40 px-2.5 py-1.5 font-mono text-sm outline-none focus:border-mint"
                />
                <span className="whitespace-nowrap font-mono text-xs text-mint">
                  → {num(burn * cfg.portfolioToOptRatio, 0)} OPT
                </span>
              </div>
              <button
                className="btn btn-ghost w-full py-1.5 text-xs"
                disabled={busy || myFree < burn || burn <= 0}
                onClick={() => act(() => pvpConvert(matchId, burn))}
              >
                {myFree < burn ? `Only ${usd(myFree, 0)} free` : "Burn Portfolio"}
              </button>
            </section>

            {iAmCreator && (
              <button
                className="btn btn-ghost w-full text-xs text-danger"
                disabled={busy}
                onClick={() => act(() => endMatchNow(matchId))}
              >
                <Flag size={13} className="mr-1 inline" />
                End match now
              </button>
            )}
          </div>
        </div>
      ) : (
        cards.length > 0 && (
          <section className="panel p-4">
            <h2 className="mb-3 font-semibold">Match cards</h2>
            <CardGrid cards={cards} prices={prices} meId={meId} readOnly />
          </section>
        )
      )}

      <Link href="/pvp" className="block text-center text-xs text-mute hover:text-buy">
        ← back to PvP
      </Link>
    </div>
  );
}
