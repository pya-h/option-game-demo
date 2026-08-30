"use client";

import { motion } from "framer-motion";
import { BatteryCharging, Battery, Recycle, Zap } from "lucide-react";
import { useState } from "react";
import {
  buyCapacityChip,
  buyEnergyCell,
  buyEnergyCharge,
  convertPortfolioToOpt,
} from "@/app/actions/store";
import { useGame } from "@/components/GameProvider";
import { num, usd } from "@/lib/fmt";

export default function StorePage() {
  const { state, run, busy } = useGame();
  const [burn, setBurn] = useState(100);

  if (!state) return <div className="panel h-64 animate-pulse opacity-50" />;
  const me = state.me;
  const cfg = state.cfg;

  // Clamped the same way the server clamps it, so a player below a raised starting capacity
  // sees the first tier's price rather than an undefined one.
  const tier = Math.max(
    0,
    Math.round((me.energy_capacity - cfg.initialEnergyCapacity) / cfg.energyCellStep)
  );
  const maxed = tier >= cfg.energyCellPrices.length;
  // Guarded rather than indexed blind: at max tier there is no next price, and `spendable <
  // undefined` is quietly false, which would leave the button enabled on a purchase that
  // cannot happen.
  const cellPrice = maxed ? null : cfg.energyCellPrices[tier];
  const chipPrice = maxed ? null : cfg.energyCapacityPrices[tier];
  const full = me.energy >= me.energy_capacity;
  const nextCap = me.energy_capacity + cfg.energyCellStep;
  // What the bundle saves against buying the two pieces separately.
  const saving = cellPrice !== null && chipPrice !== null
    ? chipPrice + cfg.energyChargePrice - cellPrice
    : 0;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">🏪 Store</h1>
        <p className="mt-1 text-xs text-mute">
          Everything here is bought with Portfolio Value — the same number that ranks you. Spending
          makes you stronger now and costs you leaderboard position.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {/* Energy Cell — capacity + refill, the bundle */}
        <Item
          icon={Zap}
          tone="from-amber-400 to-orange-500"
          title="Energy Cell"
          subtitle="Capacity +, and charged to full"
          badge={saving > 0 ? `save ${usd(saving, 0)}` : undefined}
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">
              {Math.floor(me.energy)} / {me.energy_capacity}
            </span>
            <span className="text-gold">→</span>
            <span className="text-gold">
              {nextCap} / {nextCap}
            </span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            {maxed
              ? "You've installed every cell available."
              : `Tier ${tier + 1} of ${cfg.energyCellPrices.length} · both upgrades in one`}
          </p>
          <button
            className="btn btn-gold w-full"
            disabled={busy || cellPrice === null || me.spendable < cellPrice}
            onClick={() => run(() => buyEnergyCell())}
          >
            {cellPrice === null ? "Max capacity" : `Install · ${usd(cellPrice, 0)}`}
          </button>
        </Item>

        {/* Capacity Chip — the ceiling only */}
        <Item
          icon={Battery}
          tone="from-violet-400 to-fuchsia-500"
          title="Capacity Chip"
          subtitle="Raises the ceiling only"
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">{me.energy_capacity}</span>
            <span className="text-sell">→</span>
            <span className="text-sell">{nextCap}</span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            {maxed
              ? "Capacity is already at its maximum."
              : "The new slots fill at the usual rate — no top-up."}
          </p>
          <button
            className="btn btn-sell w-full"
            disabled={busy || chipPrice === null || me.spendable < chipPrice}
            onClick={() => run(() => buyCapacityChip())}
          >
            {chipPrice === null ? "Max capacity" : `Fit · ${usd(chipPrice, 0)}`}
          </button>
        </Item>

        {/* Energy Charge — the bar only */}
        <Item
          icon={BatteryCharging}
          tone="from-cyan-400 to-blue-500"
          title="Energy Charge"
          subtitle="Instant refill to full"
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">
              {Math.floor(me.energy)} / {me.energy_capacity}
            </span>
            <span className="text-buy">→</span>
            <span className="text-buy">
              {me.energy_capacity} / {me.energy_capacity}
            </span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            Energy regenerates +1 every {Math.round(cfg.energyRefillSeconds / 60)} min on its own.
          </p>
          <button
            className="btn btn-primary w-full"
            disabled={busy || full || me.spendable < cfg.energyChargePrice}
            onClick={() => run(() => buyEnergyCharge())}
          >
            {full ? "Already full" : `Refill · ${usd(cfg.energyChargePrice, 0)}`}
          </button>
        </Item>

        {/* Portfolio -> OPT */}
        <Item
          icon={Recycle}
          tone="from-emerald-400 to-teal-500"
          title="Portfolio → OPT"
          subtitle={`Burn $1 for ${cfg.portfolioToOptRatio} OPT`}
        >
          <div className="mb-2 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-danger">−{usd(burn, 0)}</span>
            <span className="text-mint">→</span>
            <span className="text-mint">+{num(burn * cfg.portfolioToOptRatio, 0)} OPT</span>
          </div>
          <input
            type="range"
            min={10}
            max={Math.max(10, Math.floor(me.spendable) || 10)}
            step={10}
            value={Math.min(burn, Math.max(10, Math.floor(me.spendable) || 10))}
            onChange={(e) => setBurn(Number(e.target.value))}
            className="mb-3 w-full"
            style={{
              ["--pct" as any]: `${(burn / Math.max(10, Math.floor(me.spendable) || 10)) * 100}%`,
            }}
          />
          <p className="mb-3 text-center text-[11px] text-mute">
            {usd(me.spendable, 0)} free to burn. Locked collateral can&apos;t be converted.
          </p>
          <button
            className="btn btn-primary w-full"
            disabled={busy || me.spendable < burn || burn <= 0}
            onClick={() => run(() => convertPortfolioToOpt(burn))}
          >
            Burn for OPT
          </button>
        </Item>
      </div>
    </div>
  );
}

function Item({
  icon: Icon,
  tone,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: any;
  tone: string;
  title: string;
  subtitle: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      className="panel panel-hi foil flex flex-col p-5"
    >
      <div className="mb-3 flex items-start">
        <div
          className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${tone} text-black shadow-lg`}
        >
          <Icon size={22} />
        </div>
        {badge && (
          <span className="ml-auto rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-semibold text-mint">
            {badge}
          </span>
        )}
      </div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-mute">{subtitle}</p>
      <div className="mt-auto">{children}</div>
    </motion.section>
  );
}
