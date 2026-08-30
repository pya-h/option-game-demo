"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useGame } from "./GameProvider";

const COLORS = ["#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#a855f7"];

/**
 * Fires once whenever the number of winning cards goes up, so a card resolving in the
 * player's favour is felt rather than just quietly appearing in a list.
 */
export default function Confetti() {
  const { state } = useGame();
  const [burst, setBurst] = useState(0);
  const prev = useRef<number | null>(null);

  const wins = state
    ? state.cards.filter((c) => c.owner_id === state.me.id && c.status === "WON").length
    : 0;

  useEffect(() => {
    if (prev.current !== null && wins > prev.current) setBurst((b) => b + 1);
    prev.current = wins;
  }, [wins]);

  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(0), 2200);
    return () => clearTimeout(t);
  }, [burst]);

  return (
    <AnimatePresence>
      {burst > 0 && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
          {Array.from({ length: 40 }).map((_, i) => {
            const angle = (i / 40) * Math.PI * 2;
            const dist = 180 + ((i * 37) % 260);
            return (
              <motion.span
                key={`${burst}-${i}`}
                initial={{ x: "50vw", y: "40vh", opacity: 1, scale: 1 }}
                animate={{
                  x: `calc(50vw + ${Math.cos(angle) * dist}px)`,
                  y: `calc(40vh + ${Math.sin(angle) * dist + 220}px)`,
                  opacity: 0,
                  scale: 0.4,
                  rotate: (i % 2 ? 1 : -1) * 540,
                }}
                transition={{ duration: 1.8, ease: "easeOut" }}
                className="absolute block h-2.5 w-1.5 rounded-sm"
                style={{ background: COLORS[i % COLORS.length] }}
              />
            );
          })}
        </div>
      )}
    </AnimatePresence>
  );
}
