"use client";

import { Coins, Flame, Star, Wallet, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { duration, num, usd } from "@/lib/fmt";
import { useGame } from "./GameProvider";

/** Eases a number toward its target so balance changes read as a roll-up, not a jump. */
function useRoll(target: number) {
  const [v, setV] = useState(target);
  const raf = useRef(0);
  useEffect(() => {
    const from = v;
    if (from === target) return;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 550);
      setV(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return v;
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="panel flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}>
        <Icon size={17} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-mute">{label}</div>
        <div className="tabnum truncate font-mono text-lg font-semibold leading-tight">{value}</div>
        {sub}
      </div>
    </div>
  );
}

export default function ResourceBar() {
  const { state } = useGame();
  const me = state?.me;
  const optV = useRoll(me?.opt ?? 0);
  const pfV = useRoll(me?.portfolio ?? 0);
  const xpV = useRoll(me?.xp ?? 0);

  if (!me) {
    return (
      <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel h-[62px] animate-pulse opacity-50" />
        ))}
      </div>
    );
  }

  const pct = (me.energy / Math.max(1, me.energy_capacity)) * 100;

  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <Stat
        icon={Coins}
        label="OPT"
        tone="bg-cyan-500/15 text-buy"
        value={num(optV, 0)}
        sub={
          <div className="text-[11px] text-mute">
            {me.dripActive ? (
              <>
                +{num(me.optPerDrip, 0)} in{" "}
                <span className="text-buy">{duration(Math.ceil(me.nextOptMs / 1000))}</span>
              </>
            ) : (
              // The drip is gated on having played, so say so rather than showing a timer
              // that will never fire.
              <span className="text-mute">play a hand to restart drops</span>
            )}
          </div>
        }
      />
      <Stat
        icon={Wallet}
        label="Portfolio"
        tone="bg-emerald-500/15 text-mint"
        value={usd(pfV, 0)}
        sub={
          <div className="text-[11px] text-mute">
            {me.locked > 0 ? (
              <>
                <span className="text-gold">{usd(me.locked, 0)} locked</span> ·{" "}
                {usd(me.spendable, 0)} free
              </>
            ) : (
              <>rank #{me.portfolioRank} of {me.players}</>
            )}
          </div>
        }
      />
      <Stat
        icon={Zap}
        label="Energy"
        tone="bg-amber-500/15 text-gold"
        value={`${Math.floor(me.energy)} / ${me.energy_capacity}`}
        sub={
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        }
      />
      <Stat
        icon={Star}
        label={`Level ${me.level}`}
        tone="bg-fuchsia-500/15 text-sell"
        value={`${num(xpV, 0)} XP`}
        sub={
          <div className="mt-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge">
              <div
                className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-violet-500 transition-[width] duration-700"
                style={{ width: `${me.levelPct}%` }}
              />
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-mute">
              <Flame size={10} className="text-sell" />
              {num(me.levelSpan - me.levelInto, 0)} to L{me.level + 1} · rank #{me.xpRank}
            </div>
          </div>
        }
      />
    </div>
  );
}
