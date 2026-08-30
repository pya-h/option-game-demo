"use client";

import { ASSET_MAP } from "@/lib/config";
import { price } from "@/lib/fmt";
import { useGame } from "./GameProvider";

export default function PriceTicker() {
  const { state } = useGame();
  const prices = state?.prices ?? [];
  if (!prices.length) return <div className="mt-3 h-8" />;

  const row = prices.map((p) => {
    const up = p.price >= p.prev_price;
    const delta = p.prev_price ? ((p.price - p.prev_price) / p.prev_price) * 100 : 0;
    return (
      <span key={p.asset} className="mx-5 inline-flex items-center gap-2 font-mono text-xs">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: ASSET_MAP[p.asset]?.tint, boxShadow: `0 0 8px ${ASSET_MAP[p.asset]?.tint}` }}
        />
        <span className="font-semibold text-slate-200">{p.asset}</span>
        <span
          key={p.price}
          className={`tabnum ${delta === 0 ? "" : up ? "flash-up" : "flash-down"} text-slate-400`}
        >
          {price(p.price)}
        </span>
        {delta !== 0 && (
          <span className={up ? "text-mint" : "text-danger"}>
            {up ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}%
          </span>
        )}
      </span>
    );
  });

  return (
    <div className="ticker mt-3 overflow-hidden rounded-xl border border-edge/60 bg-black/30 py-2">
      <div className="ticker-track">
        <div className="flex shrink-0">{row}</div>
        <div className="flex shrink-0" aria-hidden>
          {row}
        </div>
      </div>
    </div>
  );
}
