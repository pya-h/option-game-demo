"use client";

import { useEffect, useState } from "react";
import { clock } from "@/lib/fmt";

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
  return (
    <span className={`tabnum font-mono ${urgent ? "text-danger" : ""} ${className}`}>
      {left <= 0 ? "settling…" : clock(left)}
    </span>
  );
}
