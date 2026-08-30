"use client";

import { useEffect, useState } from "react";
import { clock, duration } from "@/lib/fmt";

/** Ticks locally every second so timers stay smooth between 5s state polls. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function Countdown({ to, className = "" }: { to: string; className?: string }) {
  const now = useNow();
  const left = new Date(to).getTime() - now;
  const urgent = left < 60_000;
  // Now that expiries run to a month, a raw HH:MM:SS clock would read "720:00:00". Past a day
  // the exact second stops being the interesting part, so switch to a compact label.
  const label =
    left <= 0 ? "settling…" : left >= 86_400_000 ? duration(left / 1000) : clock(left);
  return (
    <span className={`tabnum font-mono ${urgent ? "text-danger" : ""} ${className}`}>{label}</span>
  );
}
