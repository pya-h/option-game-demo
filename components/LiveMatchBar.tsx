"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Swords, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { leaveQueue } from "@/app/actions/matchmaking";
import { duration as fmtDuration } from "@/lib/fmt";
import { useGame } from "./GameProvider";

/**
 * A persistent strip for the two PvP states a player can be in without looking at the PvP page:
 * searching, and playing.
 *
 * The queue is drained server-side by whichever request happens to be polling, so a match can
 * form while the player is buying Energy or reading the leaderboard — and until now nothing told
 * them. Searching costs nothing, but a formed match charges Energy and starts a clock, so
 * missing it is the one thing the feature must not do. Mounted in the game layout, so it follows
 * the player everywhere; it hides itself inside the match room, where the page already says all
 * of this louder.
 */
export default function LiveMatchBar() {
  const { state, run, busy } = useGame();
  const router = useRouter();
  const path = usePathname();
  const [elapsed, setElapsed] = useState(0);
  const wasQueued = useRef(false);

  const queue = state?.queue ?? null;
  const liveId = state?.liveMatchId ?? null;

  // A matchmade player is dropped straight into a running match without clicking anything, so
  // the only signal is the queue entry vanishing while a live match appears. Navigate once,
  // then let the bar carry the match for as long as it runs.
  useEffect(() => {
    if (queue) wasQueued.current = true;
    else if (wasQueued.current) {
      wasQueued.current = false;
      if (liveId) router.push(`/pvp/${liveId}`);
    }
  }, [queue, liveId, router]);

  useEffect(() => {
    if (!queue) return setElapsed(0);
    const start = new Date(queue.queuedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [queue]);

  // Each state is suppressed exactly where the page already says it, so the player never reads
  // the same status twice: the search on /pvp, where the Quick Match panel owns it, and the
  // match inside its own room.
  const inRoom = liveId !== null && path === `/pvp/${liveId}`;
  const show = queue ? path !== "/pvp" : liveId !== null && !inRoom;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -10, height: 0 }}
          className="overflow-hidden"
        >
          {queue ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-buy/40 bg-buy/10 px-3.5 py-2.5">
              <Loader2 size={16} className="shrink-0 animate-spin text-buy" />
              <span className="text-sm font-semibold">
                {queue.mode === "DUEL" ? "Finding an opponent…" : `Finding ${queue.size} players…`}
              </span>
              <span className="tabnum font-mono text-[11px] text-mute">
                {queue.waiting} of {queue.size} · {fmtDuration(queue.durationMin * 60)} match ·{" "}
                {fmtDuration(elapsed)}
              </span>
              <button
                className="btn btn-ghost ml-auto py-1 text-xs"
                disabled={busy}
                onClick={() => run(() => leaveQueue())}
              >
                <X size={12} className="mr-1 inline" />
                Cancel
              </button>
            </div>
          ) : (
            <Link
              href={`/pvp/${liveId}`}
              className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-mint/40 bg-mint/10 px-3.5 py-2.5 transition hover:border-mint/70"
            >
              <motion.span
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="shrink-0 text-mint"
              >
                <Swords size={16} />
              </motion.span>
              <span className="text-sm font-semibold">You&apos;re in a live match</span>
              <span className="text-[11px] text-mute">
                PvP OPT is your only limit in there — no Energy is charged.
              </span>
              <span className="btn btn-primary ml-auto py-1 text-xs">Enter arena →</span>
            </Link>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
