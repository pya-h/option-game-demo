"use client";

import { motion } from "framer-motion";
import { Coins, Lock, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createCard } from "@/app/actions/cards";
import { ASSETS, EXPIRIES, type AssetSymbol } from "@/lib/config";
import { amt, price, usd } from "@/lib/fmt";
import { collateralFor, defaultAmount, quotePremium } from "@/lib/options";
import type { PriceDTO } from "@/lib/types";
import { useGame } from "./GameProvider";

export default function CreateOptionPanel({
  prices,
  optBalance,
  spendable,
  energy,
  energyCost,
  matchId = null,
  maxSeconds,
  premiumOptPerDollar,
  onCreated,
}: {
  prices: PriceDTO[];
  optBalance: number;
  spendable: number;
  energy?: number;
  energyCost?: number;
  matchId?: number | null;
  maxSeconds?: number;
  premiumOptPerDollar: number;
  onCreated?: () => void;
}) {
  const { run, busy } = useGame();
  const [asset, setAsset] = useState<AssetSymbol>("BTC");
  const [kind, setKind] = useState<"BUY" | "SELL">("BUY");
  const [pct, setPct] = useState(1);
  const [seconds, setSeconds] = useState(300);
  const [amount, setAmount] = useState<number | null>(null);

  const spot = prices.find((p) => p.asset === asset)?.price ?? 0;
  const expiries = useMemo(
    () => EXPIRIES.filter((e) => maxSeconds === undefined || e.seconds <= maxSeconds),
    [maxSeconds]
  );

  // Re-baseline the amount whenever the asset changes so the notional stays sane.
  useEffect(() => {
    if (spot > 0) setAmount(defaultAmount(spot));
  }, [asset, spot > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!expiries.some((e) => e.seconds === seconds) && expiries.length) setSeconds(expiries[0].seconds);
  }, [expiries, seconds]);

  const amt0 = amount ?? 0;
  const strike = spot * (1 + pct / 100);
  const notional = strike * amt0;
  const premium =
    spot > 0 && amt0 > 0
      ? quotePremium({ asset, strike, amount: amt0, spot, seconds }, premiumOptPerDollar)
      : 0;
  const collateral = kind === "SELL" ? collateralFor(strike, amt0) : 0;

  const noEnergy = energy !== undefined && energyCost !== undefined && energy < energyCost;
  const cantAfford = kind === "BUY" ? optBalance < premium : spendable < collateral;
  const blocked = !spot || !amt0 || busy || noEnergy || cantAfford || !expiries.length;

  const reason = !spot
    ? "waiting for prices…"
    : noEnergy
      ? `Not enough Energy (need ${energyCost})`
      : kind === "BUY" && cantAfford
        ? `Need ${premium} OPT`
        : kind === "SELL" && cantAfford
          ? `Need ${usd(collateral, 0)} free Portfolio`
          : null;

  const submit = async () => {
    const ok = await run(
      () => createCard({ kind, asset, strikePct: pct, amount: amt0, seconds, matchId }),
      "Card created"
    );
    if (ok) onCreated?.();
  };

  const accent = kind === "BUY" ? "#22d3ee" : "#f472b6";

  return (
    <section className="panel panel-hi p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} style={{ color: accent }} />
        <h2 className="font-semibold">Mint an Option Card</h2>
        <div className="ml-auto flex rounded-xl border border-edge p-0.5">
          {(["BUY", "SELL"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                kind === k
                  ? k === "BUY"
                    ? "bg-buy/20 text-buy shadow-[0_0_18px_-6px_#22d3ee]"
                    : "bg-sell/20 text-sell shadow-[0_0_18px_-6px_#f472b6]"
                  : "text-mute hover:text-slate-200"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-mute">
        {kind === "BUY"
          ? "Pay an OPT premium for the right to buy above your strike. Wins if the price finishes above it."
          : "Earn an OPT premium for the obligation. Locks Portfolio collateral; you pay out if the price finishes above the strike."}
      </p>

      {/* asset grid */}
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {ASSETS.map((a) => {
          const p = prices.find((x) => x.asset === a.symbol)?.price ?? 0;
          const on = asset === a.symbol;
          return (
            <button
              key={a.symbol}
              onClick={() => setAsset(a.symbol)}
              className="rounded-xl border px-2 py-2 text-left transition"
              style={{
                borderColor: on ? a.tint : "#1e2542",
                background: on ? `${a.tint}1f` : "rgba(255,255,255,0.02)",
                boxShadow: on ? `0 0 22px -8px ${a.tint}` : undefined,
              }}
            >
              <div className="font-mono text-xs font-bold" style={{ color: on ? a.tint : "#cdd5f0" }}>
                {a.symbol}
              </div>
              <div className="tabnum truncate text-[10px] text-mute">{p ? price(p) : "—"}</div>
            </button>
          );
        })}
      </div>

      {/* strike */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-mute">Strike</span>
          <span className="tabnum font-mono text-slate-200">
            {price(strike)}{" "}
            <span className={pct >= 0 ? "text-mint" : "text-danger"}>
              ({pct >= 0 ? "+" : ""}
              {pct.toFixed(1)}%)
            </span>
          </span>
        </div>
        <input
          type="range"
          min={-20}
          max={20}
          step={0.5}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-full"
          style={{ ["--pct" as any]: `${((pct + 20) / 40) * 100}%` }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-mute">
          <span>−20% (deep in the money)</span>
          <span>spot {price(spot)}</span>
          <span>+20% (long shot)</span>
        </div>
      </div>

      {/* amount + expiry */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs text-mute">Amount</div>
          <div className="flex items-center gap-1">
            <button
              className="chip"
              onClick={() => setAmount((a) => Math.max((a ?? 0) / 2, 1e-8))}
              disabled={!amt0}
            >
              /2
            </button>
            <input
              value={amt0}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              type="number"
              step="any"
              className="tabnum w-full rounded-lg border border-edge bg-black/40 px-2.5 py-1.5 text-center font-mono text-sm outline-none focus:border-buy"
            />
            <button className="chip" onClick={() => setAmount((a) => (a ?? 0) * 2)}>
              ×2
            </button>
          </div>
          <div className="mt-1 text-[10px] text-mute">
            notional {usd(notional, 0)} · {amt(amt0)} {asset}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs text-mute">Expires in</div>
          <div className="flex flex-wrap gap-1.5">
            {expiries.map((e) => (
              <button
                key={e.seconds}
                data-on={seconds === e.seconds}
                onClick={() => setSeconds(e.seconds)}
                className="chip"
              >
                {e.label}
              </button>
            ))}
            {!expiries.length && <span className="text-[11px] text-danger">match ending</span>}
          </div>
        </div>
      </div>

      {/* quote */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-edge/70 bg-black/25 px-3 py-2.5 text-xs">
        <span className="inline-flex items-center gap-1.5 text-mute">
          <Coins size={13} style={{ color: accent }} />
          {kind === "BUY" ? "Premium" : "You receive"}
        </span>
        <motion.span key={premium} initial={{ scale: 1.18 }} animate={{ scale: 1 }} className="tabnum font-mono font-semibold" style={{ color: accent }}>
          {kind === "BUY" ? "−" : "+"}
          {premium} OPT
        </motion.span>
        {kind === "SELL" && (
          <>
            <span className="text-edge">|</span>
            <span className="inline-flex items-center gap-1.5 text-mute">
              <Lock size={13} className="text-gold" /> Collateral
            </span>
            <span className="tabnum font-mono font-semibold text-gold">{usd(collateral, 0)}</span>
          </>
        )}
        {energyCost !== undefined && (
          <>
            <span className="text-edge">|</span>
            <span className="inline-flex items-center gap-1 text-gold">
              <Zap size={13} /> −{energyCost}
            </span>
          </>
        )}
      </div>

      <button
        onClick={submit}
        disabled={blocked}
        className={`btn w-full ${kind === "BUY" ? "btn-primary" : "btn-sell"}`}
        title={reason ?? undefined}
      >
        {reason ?? (busy ? "Minting…" : `Mint ${kind} Option`)}
      </button>
    </section>
  );
}
