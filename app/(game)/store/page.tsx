"use client";

import { motion } from "framer-motion";
import { BatteryCharging, Recycle, Zap } from "lucide-react";
import { useState } from "react";
import { buyEnergyCell, buyEnergyCharge, convertPortfolioToOpt } from "@/app/actions/store";
import { useGame } from "@/components/GameProvider";
import { num, usd } from "@/lib/fmt";

export default function StorePage() {
  const { state, run, busy } = useGame();
  const [burn, setBurn] = useState(100);

  if (!state) return <div className="panel h-64 animate-pulse opacity-50" />;
  const me = state.me;
  const cfg = state.cfg;

  const tier = Math.round((me.energy_capacity - cfg.initialEnergyCapacity) / cfg.energyCellStep);
  const cellPrice = cfg.energyCellPrices[tier];
  const maxed = tier >= cfg.energyCellPrices.length;
  const full = me.energy >= me.energy_capacity;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">🏪 Store</h1>
        <p className="mt-1 text-xs text-mute">
          Everything here is bought with Portfolio Value — the same number that ranks you. Spending
          makes you stronger now and costs you leaderboard position.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Energy Cell */}
        <Item
          icon={Zap}
          tone="from-amber-400 to-orange-500"
          title="Energy Cell"
          subtitle="Permanent capacity upgrade"
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">{me.energy_capacity}</span>
            <span className="text-gold">→</span>
            <span className="text-gold">{me.energy_capacity + cfg.energyCellStep}</span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            {maxed
              ? "You've installed every cell available."
              : `Tier ${tier + 1} of ${cfg.energyCellPrices.length}`}
          </p>
          <button
            className="btn btn-gold w-full"
            disabled={busy || maxed || me.spendable < cellPrice}
            onClick={() => run(() => buyEnergyCell())}
          >
            {maxed ? "Max capacity" : `Upgrade · ${usd(cellPrice, 0)}`}
          </button>
        </Item>

        {/* Energy Charge */}
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
  children,
}: {
  icon: any;
  tone: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      className="panel panel-hi foil flex flex-col p-5"
    >
      <div
        className={`mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${tone} text-black shadow-lg`}
      >
        <Icon size={22} />
      </div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-mute">{subtitle}</p>
      <div className="mt-auto">{children}</div>
    </motion.section>
  );
}
