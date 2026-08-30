"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Radar, Users, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { joinQueue, leaveQueue } from "@/app/actions/matchmaking";
import { GROUP_SIZES, MATCH_DURATIONS } from "@/lib/config";
import { duration as fmtDuration } from "@/lib/fmt";
import { useGame } from "./GameProvider";

/**
 * Press search, get a game. The queue itself lives server-side and is drained by the same lazy
 * pass that settles cards, so all this component does is say what it wants, show progress, and
 * move the player into the match the moment one forms.
 */
export default function QuickMatch() {
  const { state, run, busy } = useGame();

  const [mode, setMode] = useState<"DUEL" | "GROUP">("DUEL");
  const [size, setSize] = useState(3);
  const [durationMin, setDurationMin] = useState(15);
  const [elapsed, setElapsed] = useState(0);

  const queue = state?.queue ?? null;
  const cost = state?.cfg.pvpEnergyCost ?? 0;
  const energy = state?.me.energy ?? 0;

  // Being taken to the match once it forms is LiveMatchBar's job — it's mounted in the layout,
  // so it still works for a player who wandered off this page while searching.
  useEffect(() => {
    if (!queue) return setElapsed(0);
    const start = new Date(queue.queuedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [queue]);

  const search = () =>
    run(() => joinQueue({ mode, size: mode === "DUEL" ? 2 : size, durationMin }));

  const target = queue ? queue.size : mode === "DUEL" ? 2 : size;
  const have = queue?.waiting ?? 0;
  const short = energy < cost;

  return (
    <section className="panel panel-hi p-4">
      <div className="mb-3 flex items-center gap-2">
        <Radar size={16} className="text-buy" />
        <h2 className="font-semibold">Quick Match</h2>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gold">
          <Zap size={12} /> {cost} on match
        </span>
      </div>

      <AnimatePresence mode="wait">
        {queue ? (
          <motion.div
            key="searching"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-buy/40 bg-buy/10 px-3.5 py-3">
              <Loader2 size={18} className="animate-spin text-buy" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {queue.mode === "DUEL" ? "Finding an opponent…" : `Finding ${queue.size} players…`}
                </div>
                <div className="tabnum text-[11px] text-mute">
                  {have} of {target} ready · {fmtDuration(queue.durationMin * 60)} match ·{" "}
                  {fmtDuration(elapsed)} elapsed
                </div>
              </div>
            </div>

            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/5">
              <motion.div
                className="h-full rounded-full bg-buy"
                animate={{ width: `${Math.min(100, (have / target) * 100)}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>

            <p className="mb-3 text-[11px] leading-relaxed text-mute">
              Energy is charged when the match forms, not now. Keep this tab open — the search
              drops you if it stops hearing from you.
            </p>

            <button
              className="btn btn-ghost w-full"
              disabled={busy}
              onClick={() => run(() => leaveQueue())}
            >
              <X size={14} className="mr-1 inline" />
              Cancel search
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <p className="mb-3 text-[11px] leading-relaxed text-mute">
              Get matched with whoever else is searching. No invites, no usernames — players are
              only ever grouped with others who asked for the same size and length.
            </p>

            <div className="mb-3 flex rounded-xl border border-edge p-0.5">
              {(["DUEL", "GROUP"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                    mode === m ? "bg-buy/20 text-buy" : "text-mute hover:text-slate-200"
                  }`}
                >
                  {m === "DUEL" ? "1v1" : "Group"}
                </button>
              ))}
            </div>

            {mode === "GROUP" && (
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs text-mute">
                  <Users size={12} /> Players
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {GROUP_SIZES.map((n) => (
                    <button
                      key={n}
                      data-on={size === n}
                      onClick={() => setSize(n)}
                      className="chip"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-3">
              <div className="mb-1.5 text-xs text-mute">Match length</div>
              <div className="flex flex-wrap gap-1.5">
                {MATCH_DURATIONS.map((d) => (
                  <button
                    key={d}
                    data-on={durationMin === d}
                    onClick={() => setDurationMin(d)}
                    className="chip"
                  >
                    {fmtDuration(d * 60)}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn btn-primary w-full" disabled={busy || short} onClick={search}>
              <Radar size={14} className="mr-1 inline" />
              {short
                ? `Need ${cost} Energy`
                : mode === "DUEL"
                  ? "Find opponent"
                  : `Find ${size} players`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
