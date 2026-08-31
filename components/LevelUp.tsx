"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronsUp, Sparkles, Star, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { acknowledgeLevel } from "@/app/actions/progress";
import { num } from "@/lib/fmt";
import { rewardsAt } from "@/lib/levels";
import { useGame } from "./GameProvider";

/**
 * The level-up moment.
 *
 * Driven by `pendingLevelUp` from the polled state rather than by watching XP change on the
 * client, and that distinction is the whole feature. A card can run for a month and settles on
 * whichever poll happens to reach it, so XP routinely arrives while the player is on another
 * page, in a match, or signed out for a week. The server owes the celebration — it holds
 * `level_seen` until the client says it has actually been shown — so signing back in opens
 * with the moment rather than with a quietly larger number.
 *
 * Several levels can land at once for the same reason; the modal names the highest and says how
 * many were passed on the way.
 */
export default function LevelUp() {
  const { state, refresh } = useGame();
  const pending = state?.me.pendingLevelUp ?? null;
  const [showing, setShowing] = useState<{ from: number; to: number } | null>(null);
  const acking = useRef(false);

  useEffect(() => {
    if (!pending || showing || acking.current) return;
    setShowing(pending);
    // Acknowledge as soon as it is on screen. If the tab dies mid-celebration the player has
    // still seen it, and re-showing a level they already read is worse than missing it.
    acking.current = true;
    acknowledgeLevel()
      .then(() => refresh())
      .finally(() => {
        acking.current = false;
      });
  }, [pending, showing, refresh]);

  const close = () => setShowing(null);
  const levels = showing ? showing.to - showing.from : 0;
  // Everything unlocked across every level crossed, not just the last one.
  const rewards = showing
    ? Array.from({ length: levels }, (_, i) => showing.from + 1 + i).flatMap(rewardsAt)
    : [];
  const merged = mergeRewards(rewards);

  return (
    <AnimatePresence>
      {showing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4 backdrop-blur-md"
        >
          {/* rays behind the card, so the moment reads as an event rather than a dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.6, rotate: 0 }}
            animate={{ opacity: 0.5, scale: 1, rotate: 360 }}
            transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
            className="levelup-rays pointer-events-none absolute"
          />

          <motion.div
            initial={{ scale: 0.8, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
            className="levelup-card relative w-full max-w-sm p-6 text-center"
          >
            <button
              onClick={close}
              className="absolute right-3 top-3 text-mute transition hover:text-white"
            >
              <X size={16} />
            </button>

            <motion.div
              initial={{ scale: 0.4, rotate: -25 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.1 }}
              className="mx-auto mb-3 grid h-20 w-20 place-items-center"
            >
              <span className="levelup-badge">{showing.to}</span>
            </motion.div>

            <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.28em] text-gold">
              <ChevronsUp size={13} /> Level up
            </div>
            <h2 className="mb-1 text-2xl font-bold">
              Level {showing.from} → <span className="text-gold">{showing.to}</span>
            </h2>
            <p className="mb-4 text-xs text-mute">
              {levels > 1
                ? `${levels} levels while you were away.`
                : "Your options are paying off."}
            </p>

            <div className="mb-4 grid grid-cols-2 gap-2 text-left">
              <Fact label="Total XP" value={num(state?.me.xp ?? 0, 0)} icon={Star} />
              <Fact
                label="To next level"
                value={`${num(state?.me.levelSpan ?? 0, 0)} XP`}
                icon={Sparkles}
              />
            </div>

            <div className="mb-4 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5 text-left">
              <div className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-gold">
                <Zap size={11} /> Unlocked
              </div>
              <ul className="space-y-1 text-xs text-slate-200">
                {merged.map((r) => (
                  <motion.li
                    key={r}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + merged.indexOf(r) * 0.08 }}
                  >
                    · {r}
                  </motion.li>
                ))}
              </ul>
            </div>

            <button onClick={close} className="btn btn-gold w-full">
              Keep playing
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Fact({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-xl border border-edge bg-black/30 px-3 py-2">
      <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-mute">
        <Icon size={10} /> {label}
      </div>
      <div className="tabnum font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

/** "+1 max Energy" five times over reads as noise; "+5 max Energy" reads as a reward. */
function mergeRewards(rewards: string[]): string[] {
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const r of rewards) {
    const m = r.match(/^\+(\d+(?:\.\d+)?) (.+)$/);
    if (!m) {
      if (!totals.has(r)) order.push(r);
      totals.set(r, NaN);
      continue;
    }
    const [, n, rest] = m;
    if (!totals.has(rest)) order.push(rest);
    totals.set(rest, (totals.get(rest) || 0) + Number(n));
  }
  return order.map((k) => (Number.isNaN(totals.get(k)!) ? k : `+${totals.get(k)} ${k}`));
}
